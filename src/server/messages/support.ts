import "server-only";

import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Viewer } from "@/server/auth/viewer";
import { createAudit } from "@/server/audit/audit";
import { databaseSchema } from "@/server/database-client";
import { createNotify } from "@/server/notifications/notify";
import { consumeForUser, type RateLimitDecision } from "@/server/rate-limit";
import { createSupabaseFileStore, PHOTO_BUCKET, SIGNED_URL_SECONDS } from "@/server/files/storage";
import { supportMessageSchema, supportRequestSchema, SUPPORT_PAGE_SIZE, type SupportConversation, type SupportInbox } from "@/lib/support";
import type { MessageResult } from "@/lib/problem-threads";
import { currentRole, THREAD_MESSAGE_PAGE_SIZE } from "./service";
import { ProblemThreadError } from "./errors";
import { persistSupportMessage } from "./persist";

type Actor = Pick<Viewer, "userId">;
type Tx = Prisma.TransactionClient;
type Dependencies = {
  rateLimit?: (id: string) => Promise<RateLimitDecision>;
  notify?: (tx: Tx, thread: { id: string; userId: string }, messageId: string, senderId: string) => Promise<void>;
};
const THREAD = { id: true, userId: true, subject: true, status: true } as const;
const time = (at: Date) => new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(at);
const shortName = (person: { firstName: string; lastName: string | null }) => `${person.firstName}${person.lastName?.trim() ? ` ${person.lastName.trim().charAt(0)}` : ""}`;
const uuid = (id: string) => z.uuid().safeParse(id).success;

/** Private threads belong to exactly their person and the office, including job-linked problem reports. */
async function authorizedThread(db: Pick<PrismaClient, "supportThread" | "profile">, actor: Actor, id: string) {
  if (!uuid(id)) throw new ProblemThreadError("forbidden");
  const role = await currentRole(db, actor);
  const thread = await db.supportThread.findFirst({ where: { id, jobParticipants: false, ...(role === "ADMIN" ? {} : { userId: actor.userId }) }, select: THREAD });
  if (!thread) throw new ProblemThreadError("forbidden");
  return { role, thread };
}

async function deliver(tx: Tx, thread: { id: string; userId: string }, messageId: string, senderId: string) {
  const recipients = senderId === thread.userId
    ? (await tx.profile.findMany({ where: { role: "ADMIN", id: { not: senderId } }, select: { id: true } })).map(person => ({ userId: person.id, payload: { officeSupportThreadId: thread.id } }))
    : [{ userId: thread.userId, payload: { supportThreadId: thread.id } }];
  await createNotify(tx)("message.received", recipients, { eventId: `support.message:${messageId}`, payload: { threadId: thread.id } });
}

/** A committed exact retry is a receipt, including after closure; it never consumes another allowance. */
async function replayReceipt(db: Pick<PrismaClient, "profile" | "supportThread" | "supportMessage">, actor: Actor,
  data: z.output<typeof supportMessageSchema>, threadId: string | null, subject?: string) {
  const old = await db.supportMessage.findUnique({ where: { requestKey: data.requestKey }, include: {
    photos: { orderBy: { position: "asc" } }, thread: { select: { ...THREAD, jobId: true, problemReportId: true } },
  } });
  if (!old) return null;
  const { role } = await authorizedThread(db, actor, old.threadId);
  if (old.authorId !== actor.userId || old.internal || (threadId !== null && old.threadId !== threadId)
    || (threadId === null && (role === "ADMIN" || old.thread.userId !== actor.userId || old.thread.jobId || old.thread.problemReportId))) throw new ProblemThreadError("forbidden");
  if (old.body !== data.text || JSON.stringify(old.photos.map(photo => photo.path)) !== JSON.stringify(data.photoPaths)
    || (threadId === null && old.thread.subject !== subject)) throw new ProblemThreadError("invalid");
  return { ok: true, threadId: old.threadId } as const;
}

async function command(db: PrismaClient, actor: Actor, raw: unknown, threadId: string | null, deps: Dependencies): Promise<MessageResult> {
  const parsed = threadId === null ? supportRequestSchema.safeParse(raw) : supportMessageSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const data = parsed.data, subject = threadId === null ? supportRequestSchema.parse(raw).subject : undefined;
    if (threadId === null) { if (await currentRole(db, actor) === "ADMIN") throw new ProblemThreadError("forbidden"); }
    else await authorizedThread(db, actor, threadId);
    const prior = await replayReceipt(db, actor, data, threadId, subject);
    if (prior) return prior;
    // The limiter uses its own connection. Keep it outside the message transaction/pool checkout.
    const rate = await (deps.rateLimit ?? ((id) => consumeForUser("message", id)))(actor.userId);
    const schema = databaseSchema(db).replaceAll('"', '""');
    return await db.$transaction(async tx => {
      // A stable key must select the same opening request even if the browser never got its first response.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`support.message:${data.requestKey}`}, 0))`;
      const replay = await replayReceipt(tx, actor, data, threadId, subject);
      if (replay) return replay; // A concurrent first attempt can commit after preflight and exhaust the limit.
      let thread: Prisma.SupportThreadGetPayload<{ select: typeof THREAD }> | undefined;
      if (threadId === null) {
        if (await currentRole(tx, actor) === "ADMIN") throw new ProblemThreadError("forbidden");
      } else {
        const candidate = await tx.supportThread.findFirst({ where: { id: threadId, jobParticipants: false }, select: { userId: true } });
        if (!candidate) throw new ProblemThreadError("forbidden");
        // #178 removals take this mutex. A non-owner office writer keeps its capability through commit.
        if (candidate.userId !== actor.userId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(178, 1)`;
        const access = await authorizedThread(tx, actor, threadId);
        // Serialize with closure and any other thread writer. Only an authorized row can be locked.
        await tx.$queryRawUnsafe(`SELECT id FROM "${schema}".support_threads WHERE id = $1::uuid FOR UPDATE`, access.thread.id);
        thread = (await authorizedThread(tx, actor, threadId)).thread;
        if (thread.status !== "OPEN") throw new ProblemThreadError("closed");
      }
      if (!rate.allowed) return { ok: false, error: "try-later", retryAfter: rate.retryAfter } as const;
      if (!thread) {
        thread = await tx.supportThread.create({ data: { userId: actor.userId, subject: subject!, jobParticipants: false } });
        await createAudit(tx)(actor, "support_thread.opened", { type: "support_threads", id: thread.id }, null, {});
      }
      const saved = await persistSupportMessage(tx, actor.userId, thread.id, data);
      if (saved.created) {
        await createAudit(tx)(actor, "support_thread.message_sent", { type: "support_threads", id: thread.id }, null, { messageId: saved.messageId, photoCount: 0 });
        await (deps.notify ?? deliver)(tx, thread, saved.messageId, actor.userId);
      }
      return { ok: true, threadId: thread.id } as const;
    }, { timeout: 30_000 });
  } catch (error) {
    if (error instanceof ProblemThreadError) return { ok: false, error: error.code };
    console.error("Support message could not be saved.");
    return { ok: false, error: "unavailable" };
  }
}

export function openSupportThread(db: PrismaClient, actor: Actor, raw: unknown, deps: Dependencies = {}) { return command(db, actor, raw, null, deps); }
export function sendSupportMessage(db: PrismaClient, actor: Actor, threadId: string, raw: unknown, deps: Dependencies = {}) { return command(db, actor, raw, threadId, deps); }

/** Bounded owner-only summaries, with no internal message contributing to preview or unread state. */
export async function getSupportInbox(db: PrismaClient, actor: Actor, requestedPage = 1): Promise<SupportInbox> {
  const role = await currentRole(db, actor);
  const where = { userId: actor.userId, jobParticipants: false };
  const total = await db.supportThread.count({ where });
  const pages = Math.max(1, Math.ceil(total / SUPPORT_PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number.isSafeInteger(requestedPage) ? requestedPage : 1));
  // Internal notes bump last_message_at in the database. Sort by public activity instead so a private
  // note cannot move a customer's conversations or reveal that the office has been discussing them.
  const schema = databaseSchema(db).replaceAll('"', '""');
  const ids = await db.$queryRawUnsafe<{ id: string }[]>(`SELECT t.id FROM "${schema}".support_threads t
    LEFT JOIN "${schema}".support_messages m ON m.thread_id=t.id AND NOT m.internal
    WHERE t.user_id=$1::uuid AND NOT t.job_participants GROUP BY t.id
    ORDER BY COALESCE(MAX(m.created_at),t.created_at) DESC,t.id DESC LIMIT $2 OFFSET $3`, actor.userId, SUPPORT_PAGE_SIZE, (page - 1) * SUPPORT_PAGE_SIZE);
  const rows = await db.supportThread.findMany({ where: { ...where, id: { in: ids.map(row => row.id) } },
    select: { id: true, subject: true, status: true, reads: { where: { userId: actor.userId }, select: { readAt: true } },
      messages: { where: { internal: false }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { body: true, authorId: true, createdAt: true } } } });
  return { role, viewerId: actor.userId, page, pages, total, threads: ids.map(({ id }) => rows.find(row => row.id === id)!).map(row => {
    const last = row.messages[0];
    return { id: row.id, subject: row.subject, closed: row.status === "CLOSED", preview: last?.body ?? "", when: last ? time(last.createdAt) : "",
      unread: Boolean(last && last.authorId !== actor.userId && (!row.reads[0] || row.reads[0].readAt < last.createdAt)) };
  }) };
}

export async function getSupportThread(db: PrismaClient, actor: Actor, id: string, signPhoto?: (path: string) => Promise<string>, before?: string): Promise<SupportConversation> {
  const { role, thread } = await authorizedThread(db, actor, id);
  if (before && (!uuid(before) || !await db.supportMessage.findFirst({ where: { id: before, threadId: id, internal: false }, select: { id: true } }))) throw new ProblemThreadError("forbidden");
  const [rows, latest, reads] = await Promise.all([
    db.supportMessage.findMany({ where: { threadId: id, internal: false }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: THREAD_MESSAGE_PAGE_SIZE + 1,
      ...(before ? { cursor: { id: before }, skip: 1 } : {}), include: { author: { select: { firstName: true, lastName: true } }, photos: { orderBy: { position: "asc" } } } }),
    db.supportMessage.findFirst({ where: { threadId: id, internal: false }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } }),
    db.supportThreadRead.findMany({ where: { threadId: id }, include: { user: { select: { role: true } } } }),
  ]);
  const hasOlder = rows.length > THREAD_MESSAGE_PAGE_SIZE, messages = rows.slice(0, THREAD_MESSAGE_PAGE_SIZE).reverse();
  const sign = signPhoto ?? (async path => createSupabaseFileStore().signedUrl(PHOTO_BUCKET, path, SIGNED_URL_SECONDS));
  return { id, subject: thread.subject, closed: thread.status === "CLOSED", latestMessageId: latest?.id ?? null, olderCursor: hasOlder ? messages[0]?.id ?? null : null, earlier: Boolean(before),
    messages: await Promise.all(messages.map(async message => ({ id: message.id, body: message.body, author: message.fromOffice ? "Trade Marketplace" : message.author ? shortName(message.author) : "Former member",
      office: message.fromOffice, own: message.authorId === actor.userId, at: message.createdAt.toISOString(), when: time(message.createdAt),
      seen: reads.some(read => read.userId !== actor.userId && (role === "ADMIN" ? read.userId === thread.userId : read.user.role === "ADMIN") && read.readAt >= message.createdAt),
      photos: await Promise.all(message.photos.map(async photo => { try { return { id: photo.id, url: await sign(photo.path) }; } catch { return { id: photo.id, url: null }; } })),
    }))) };
}

export async function markSupportThreadRead(db: PrismaClient, actor: Actor, threadId: string, messageId: string) {
  return db.$transaction(async tx => {
    await authorizedThread(tx, actor, threadId);
    if (!uuid(messageId)) throw new ProblemThreadError("forbidden");
    const message = await tx.supportMessage.findFirst({ where: { id: messageId, threadId, internal: false }, select: { createdAt: true } });
    if (!message) throw new ProblemThreadError("forbidden");
    await tx.supportThreadRead.createMany({ data: [{ threadId, userId: actor.userId, readAt: message.createdAt }], skipDuplicates: true });
    await tx.supportThreadRead.updateMany({ where: { threadId, userId: actor.userId, readAt: { lt: message.createdAt } }, data: { readAt: message.createdAt } });
  });
}
