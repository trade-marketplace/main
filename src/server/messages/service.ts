import "server-only";
import { z } from "zod";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { messageSchema, problemSchema, redactContactDetails, type MessagesData, type MessageResult } from "@/lib/problem-threads";
import type { Viewer } from "@/server/auth/viewer";
import { createNotify } from "@/server/notifications/notify";
import { consumeForUser, type RateLimitDecision } from "@/server/rate-limit";
import { createSupabaseFileStore, PHOTO_BUCKET, SIGNED_URL_SECONDS, type InspectableFileStore } from "@/server/files/storage";
import { createAudit } from "@/server/audit/audit";
import { isClaimedJob, JOB_SUMMARY_SELECT, jobThreadContextView } from "@/server/views";
import { lockSupportPhoto } from "./photo-cleanup";

type Actor = Pick<Viewer, "userId">;
type Tx = Prisma.TransactionClient;
export class ProblemThreadError extends Error { constructor(readonly code: string) { super(code); } }
const JOB_SELECT = { id: true, jobNumber: true, title: true, suburb: true, status: true, customerId: true, workerId: true,
  customer: { select: { firstName: true, lastName: true } }, worker: { select: { firstName: true, lastName: true } } } as const;
const JOB_CONTEXT_SELECT = { ...JOB_SUMMARY_SELECT, worker: { select: { id: true, firstName: true, lastName: true } } } as const;
const name = (person: { firstName: string; lastName: string | null }) => `${person.firstName}${person.lastName ? ` ${person.lastName[0]}` : ""}`;
const time = (date: Date) => new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date);
export const THREAD_MESSAGE_PAGE_SIZE = 50;

export async function currentRole(db: Pick<PrismaClient, "profile">, actor: Actor) {
  const person = await db.profile.findUnique({ where: { id: actor.userId }, select: { role: true } });
  if (!person) throw new ProblemThreadError("forbidden");
  return person.role;
}

export async function requireJobAccess(db: Pick<PrismaClient, "profile" | "job">, actor: Actor, jobId: string) {
  const role = await currentRole(db, actor);
  const job = await db.job.findUnique({ where: { id: jobId }, select: JOB_SELECT });
  if (!job || (role !== "ADMIN" && actor.userId !== job.customerId && actor.userId !== job.workerId)) throw new ProblemThreadError("forbidden");
  return job;
}
async function requireThread(tx: Tx, actor: Actor, id: string, lockJob = true) {
  const thread = await tx.supportThread.findUnique({ where: { id }, select: { id: true, jobId: true, jobParticipants: true, status: true } });
  if (!thread?.jobParticipants || !thread.jobId) throw new ProblemThreadError("forbidden");
  // A row write provides the same job lock the office helper uses, without an unqualified raw table name.
  if (lockJob) await tx.job.updateMany({ where: { id: thread.jobId }, data: { updatedAt: new Date() } });
  const job = await requireJobAccess(tx, actor, thread.jobId);
  return { thread, job };
}
export function ownsSupportPhoto(actorId: string, jobId: string, path: string) {
  const prefix = `support/${jobId}/${actorId}/`;
  return path.startsWith(prefix) && /^[a-f0-9]{32}\.webp$/.test(path.slice(prefix.length));
}
type Deps = {
  rateLimit?: (id: string) => Promise<RateLimitDecision>;
  files?: Pick<InspectableFileStore, "exists">;
  notify?: (threadId: string, messageId: string, job: { id: string; customerId: string; workerId: string | null }, senderId: string) => Promise<void>;
};
export async function requireSupportPhotosReady(tx: Tx, paths: string[], actor: Actor, jobId: string, deps: Deps) {
  if (new Set(paths).size !== paths.length || paths.some(path => !ownsSupportPhoto(actor.userId, jobId, path))) throw new ProblemThreadError("photos-pending");
  if (!paths.length) return;
  for (const path of [...paths].sort()) {
    await lockSupportPhoto(tx, path);
    const pending = await tx.supportPhotoCleanup.findUnique({ where: { path } });
    if (pending?.deleting || (!pending && !(await tx.supportMessagePhoto.count({ where: { path } })) && !(await tx.problemReportPhoto.count({ where: { path } })))) throw new ProblemThreadError("photos-pending");
  }
  try {
    const files = deps.files ?? createSupabaseFileStore();
    if (!(await Promise.all(paths.map(path => files.exists(PHOTO_BUCKET, path)))).every(Boolean)) throw new Error("pending");
  } catch { throw new ProblemThreadError("photos-pending"); }
}
async function deliver(db: Tx, threadId: string, messageId: string, job: { id: string; customerId: string; workerId: string | null }, senderId: string) {
  const office = await db.profile.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  const officeIds = new Set(office.map(p => p.id));
  const recipients = [...new Set([job.customerId, job.workerId, ...officeIds].filter((id): id is string => !!id && id !== senderId))]
    .map(userId => officeIds.has(userId) ? { userId, payload: { officeJobId: job.id } } : userId);
  await createNotify(db)("message.received", recipients, { eventId: `support.message:${messageId}`, payload: { threadId, jobId: job.id } });
}
async function command(db: PrismaClient, actor: Actor, raw: unknown, opening: boolean, threadId: string | null, deps: Deps): Promise<MessageResult> {
  const parsed = opening ? problemSchema.safeParse(raw) : messageSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const rate = await (deps.rateLimit ?? ((id) => consumeForUser("message", id)))(actor.userId);
  if (!rate.allowed) return { ok: false, error: "try-later", retryAfter: rate.retryAfter };
  try {
    const outcome = await db.$transaction(async tx => {
      const data = parsed.data;
      let thread;
      let job;
      if (opening) {
        const input = problemSchema.parse(raw);
        await tx.job.updateMany({ where: { id: input.jobId }, data: { updatedAt: new Date() } });
        job = await requireJobAccess(tx, actor, input.jobId);
        // The customer/worker must initiate a support request; this is not a general direct-message endpoint.
        if (actor.userId !== job.customerId && actor.userId !== job.workerId) throw new ProblemThreadError("forbidden");
        const existing = await tx.supportThread.findFirst({ where: { jobId: job.id, jobParticipants: true, status: "OPEN" } });
        await requireSupportPhotosReady(tx, data.photoPaths, actor, job.id, deps);
        thread = existing ?? await tx.supportThread.create({ data: { userId: job.customerId, jobId: job.id, jobParticipants: true, subject: input.reason } });
        if (!existing) await createAudit(tx)(actor, "support_thread.opened", { type: "support_threads", id: thread.id }, null, { jobId: job.id });
      } else {
        if (!threadId || !/^[0-9a-f-]{36}$/i.test(threadId)) throw new ProblemThreadError("forbidden");
        ({ thread, job } = await requireThread(tx, actor, threadId));
        if (thread.status !== "OPEN") throw new ProblemThreadError("closed");
        await requireSupportPhotosReady(tx, data.photoPaths, actor, job.id, deps);
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`support.message:${data.requestKey}`}, 0))`;
      const old = await tx.supportMessage.findUnique({ where: { requestKey: data.requestKey }, include: { photos: { orderBy: { position: "asc" } } } });
      if (old) {
        if (old.authorId !== actor.userId || old.threadId !== thread.id) throw new ProblemThreadError("forbidden");
        if (old.body !== data.text || JSON.stringify(old.photos.map(photo => photo.path)) !== JSON.stringify(data.photoPaths)) throw new ProblemThreadError("invalid");
        return { threadId: thread.id, messageId: old.id, job };
      }
      const message = await tx.supportMessage.create({ data: { threadId: thread.id, authorId: actor.userId, body: data.text, requestKey: data.requestKey,
        photos: { create: data.photoPaths.map((path, position) => ({ path, position })) } } });
      await createAudit(tx)(actor, "support_thread.message_sent", { type: "support_threads", id: thread.id }, null, { messageId: message.id, photoCount: data.photoPaths.length });
      // Launch notifications are durable IN_APP rows: save them atomically with the message. A failure rolls
      // everything back, returning the existing retryable error so the composer keeps the complete draft.
      await (deps.notify ?? ((...args) => deliver(tx, ...args)))(thread.id, message.id, job, actor.userId);
      return { threadId: thread.id, messageId: message.id, job };
    }, { timeout: 30_000 });
    return { ok: true, threadId: outcome.threadId };
  } catch (error) {
    if (error instanceof ProblemThreadError) return { ok: false, error: error.code };
    console.error("Support message could not be saved.");
    return { ok: false, error: "unavailable" };
  }
}
export function openProblemThread(db: PrismaClient, actor: Actor, raw: unknown, deps: Deps = {}) { return command(db, actor, raw, true, null, deps); }
export function sendProblemMessage(db: PrismaClient, actor: Actor, threadId: string, raw: unknown, deps: Deps = {}) { return command(db, actor, raw, false, threadId, deps); }

export async function markThreadRead(db: PrismaClient, actor: Actor, threadId: string, messageId: string) {
  return db.$transaction(async tx => {
    // A receipt authorizes against the current job, like a thread read, without changing job activity/order.
    await requireThread(tx, actor, threadId, false);
    const message = await tx.supportMessage.findFirst({ where: { id: messageId, threadId, internal: false }, select: { createdAt: true } });
    if (!message) throw new ProblemThreadError("forbidden");
    await tx.supportThreadRead.createMany({ data: [{ threadId, userId: actor.userId, readAt: message.createdAt }], skipDuplicates: true });
    // Recheck the timestamp in the write predicate after PostgreSQL acquires the row lock, so older tabs
    // cannot move a receipt backwards even when both requests initially found no receipt.
    await tx.supportThreadRead.updateMany({ where: { threadId, userId: actor.userId, readAt: { lt: message.createdAt } }, data: { readAt: message.createdAt } });
  });
}

/** Counts conversations with a newer public reply, using the same current-participant boundary as /messages. */
export async function unreadProblemThreadCount(db: Pick<PrismaClient, "supportThread">, userId: string) {
  const rows = await db.supportThread.findMany({
    where: { jobParticipants: true, job: { is: { OR: [{ customerId: userId }, { workerId: userId }] } } },
    select: { reads: { where: { userId }, select: { readAt: true } }, messages: { where: { internal: false }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { authorId: true, createdAt: true } } },
  });
  return rows.filter(row => { const last = row.messages[0]; return last && last.authorId !== userId && (!row.reads[0] || row.reads[0].readAt < last.createdAt); }).length;
}

export async function getMessages(db: PrismaClient, actor: Actor, selectedId?: string, signPhoto?: (path: string) => Promise<string>, beforeCursor?: string): Promise<MessagesData> {
  const role = await currentRole(db, actor);
  const access: Prisma.JobWhereInput = role === "ADMIN" ? {} : { OR: [{ customerId: actor.userId }, { workerId: actor.userId }] };
  const [rows, jobs] = await Promise.all([
    db.supportThread.findMany({ where: { jobParticipants: true, job: { is: access } }, orderBy: { lastMessageAt: "desc" },
      include: { job: { select: JOB_CONTEXT_SELECT }, reads: true, messages: { where: { internal: false }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } } }),
    db.job.findMany({ where: access, orderBy: { updatedAt: "desc" }, select: JOB_CONTEXT_SELECT }),
  ]);
  const selected = selectedId ? rows.find(row => row.id === selectedId) : null;
  if (selectedId && !selected) throw new ProblemThreadError("forbidden");
  const viewer = { userId: actor.userId, role };
  const summaries = rows.flatMap(row => {
    const context = row.job ? jobThreadContextView(viewer, row.job) : null;
    if (!context || !row.job) return [];
    const claimed = isClaimedJob(row.job);
    const last = row.messages[0]; const read = row.reads.find(r => r.userId === actor.userId)?.readAt;
    return [{ id: row.id, subject: redactContactDetails(row.subject, claimed), jobNumber: `TM-${context.jobNumber}`, title: redactContactDetails(context.title, claimed), preview: last ? redactContactDetails(last.body, claimed) : "", when: time(row.lastMessageAt), unread: !!last && last.authorId !== actor.userId && (!read || read < last.createdAt) }];
  });
  let view: MessagesData["selected"] = null;
  if (selected?.job) {
    const job = selected.job; const claimed = isClaimedJob(job);
    const context = jobThreadContextView(viewer, job);
    if (!context) throw new ProblemThreadError("forbidden");
    if (beforeCursor && (!z.uuid().safeParse(beforeCursor).success || !await db.supportMessage.findFirst({ where: { id: beforeCursor, threadId: selected.id, internal: false }, select: { id: true } }))) throw new ProblemThreadError("forbidden");
    const [messageRows, history, variations] = await Promise.all([
      db.supportMessage.findMany({ where: { threadId: selected.id, internal: false }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: THREAD_MESSAGE_PAGE_SIZE + 1,
        ...(beforeCursor ? { cursor: { id: beforeCursor }, skip: 1 } : {}), include: { author: { select: { firstName: true, lastName: true } }, photos: { orderBy: { position: "asc" } } } }),
      db.jobStatusHistory.findMany({ where: { jobId: job.id, toStatus: { in: ["BOOKABLE", "ASSIGNED", "SUBMITTED", "COMPLETED"] } }, orderBy: { createdAt: "asc" } }),
      db.variation.findMany({ where: { jobId: job.id }, select: { id: true, status: true, createdAt: true, decidedAt: true } }),
    ]);
    const hasOlder = messageRows.length > THREAD_MESSAGE_PAGE_SIZE;
    const messages = messageRows.slice(0, THREAD_MESSAGE_PAGE_SIZE).reverse();
    const sign = signPhoto ?? (async path => createSupabaseFileStore().signedUrl(PHOTO_BUCKET, path, SIGNED_URL_SECONDS));
    const labels = { BOOKABLE: "Paid", ASSIGNED: "Job booked", SUBMITTED: "Work finished", COMPLETED: "Job completed" };
    view = { id: selected.id, subject: redactContactDetails(selected.subject, claimed), closed: selected.status === "CLOSED",
      latestMessageId: selected.messages[0]?.id ?? null, olderCursor: hasOlder ? messages[0]?.id ?? null : null, earlier: Boolean(beforeCursor),
      job: { id: context.id, number: `TM-${context.jobNumber}`, title: redactContactDetails(context.title, claimed), suburb: context.suburb, status: context.status, worker: context.worker },
      messages: await Promise.all(messages.map(async message => ({ id: message.id, author: message.fromOffice ? "Trade Marketplace" : message.author ? name(message.author) : "Former member", office: message.fromOffice, own: message.authorId === actor.userId,
        body: redactContactDetails(message.body, claimed), at: message.createdAt.toISOString(), when: time(message.createdAt),
        photos: await Promise.all(message.photos.map(async photo => { try { return { id: photo.id, url: await sign(photo.path) }; } catch { return { id: photo.id, url: null }; } })),
        seen: selected.reads.some(read => read.userId !== actor.userId && [job.customerId, job.workerId].includes(read.userId) && read.readAt >= message.createdAt),
      }))),
      events: [...history.map(h => ({ id: h.id, label: labels[h.toStatus as keyof typeof labels], at: h.createdAt.toISOString() })), ...variations.flatMap(v => [
        { id: `${v.id}:requested`, label: "Extra work requested", at: v.createdAt.toISOString() },
        ...(v.decidedAt && ["APPROVED", "DECLINED"].includes(v.status) ? [{ id: `${v.id}:decided`, label: v.status === "APPROVED" ? "Extra work approved" : "Extra work declined", at: v.decidedAt.toISOString() }] : []),
      ])].sort((a, b) => a.at.localeCompare(b.at)),
    };
  }
  return { role, viewerId: actor.userId, threads: summaries, selected: view, jobs: jobs.flatMap(job => {
    const context = jobThreadContextView(viewer, job);
    return context ? [{ id: context.id, number: `TM-${context.jobNumber}`, title: redactContactDetails(context.title, isClaimedJob(job)) }] : [];
  }) };
}
