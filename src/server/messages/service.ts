import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { messageSchema, problemSchema, redactContactDetails, type MessagesData, type MessageResult } from "@/lib/problem-threads";
import type { Viewer } from "@/server/auth/viewer";
import { createNotify } from "@/server/notifications/notify";
import { consumeForUser, type RateLimitDecision } from "@/server/rate-limit";
import { createSupabaseFileStore, PHOTO_BUCKET, SIGNED_URL_SECONDS, type InspectableFileStore } from "@/server/files/storage";
import { createAudit } from "@/server/audit/audit";
import { lockSupportPhoto } from "./photo-cleanup";

type Actor = Pick<Viewer, "userId">;
type Tx = Prisma.TransactionClient;
export class ProblemThreadError extends Error { constructor(readonly code: string) { super(code); } }
const JOB_SELECT = { id: true, jobNumber: true, title: true, suburb: true, status: true, customerId: true, workerId: true,
  customer: { select: { firstName: true, lastName: true } }, worker: { select: { firstName: true, lastName: true } } } as const;
const name = (person: { firstName: string; lastName: string | null }) => `${person.firstName}${person.lastName ? ` ${person.lastName[0]}` : ""}`;
const time = (date: Date) => new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date);

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
async function requireThread(tx: Tx, actor: Actor, id: string) {
  const thread = await tx.supportThread.findUnique({ where: { id }, select: { id: true, jobId: true, jobParticipants: true, status: true } });
  if (!thread?.jobParticipants || !thread.jobId) throw new ProblemThreadError("forbidden");
  // A row write provides the same job lock the office helper uses, without an unqualified raw table name.
  await tx.job.updateMany({ where: { id: thread.jobId }, data: { updatedAt: new Date() } });
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
async function photosReady(tx: Tx, paths: string[], actor: Actor, jobId: string, deps: Deps) {
  if (new Set(paths).size !== paths.length || paths.some(path => !ownsSupportPhoto(actor.userId, jobId, path))) throw new ProblemThreadError("photos-pending");
  if (!paths.length) return;
  for (const path of [...paths].sort()) {
    await lockSupportPhoto(tx, path);
    const pending = await tx.supportPhotoCleanup.findUnique({ where: { path } });
    if (pending?.deleting || (!pending && !(await tx.supportMessagePhoto.count({ where: { path } })))) throw new ProblemThreadError("photos-pending");
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
        await photosReady(tx, data.photoPaths, actor, job.id, deps);
        thread = existing ?? await tx.supportThread.create({ data: { userId: job.customerId, jobId: job.id, jobParticipants: true, subject: input.reason } });
        if (!existing) await createAudit(tx)(actor, "support_thread.opened", { type: "support_threads", id: thread.id }, null, { jobId: job.id });
      } else {
        if (!threadId || !/^[0-9a-f-]{36}$/i.test(threadId)) throw new ProblemThreadError("forbidden");
        ({ thread, job } = await requireThread(tx, actor, threadId));
        if (thread.status !== "OPEN") throw new ProblemThreadError("closed");
        await photosReady(tx, data.photoPaths, actor, job.id, deps);
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
    await requireThread(tx, actor, threadId);
    const message = await tx.supportMessage.findFirst({ where: { id: messageId, threadId, internal: false }, select: { createdAt: true } });
    if (!message) throw new ProblemThreadError("forbidden");
    const previous = await tx.supportThreadRead.findUnique({ where: { threadId_userId: { threadId, userId: actor.userId } } });
    if (previous && previous.readAt >= message.createdAt) return;
    await tx.supportThreadRead.upsert({ where: { threadId_userId: { threadId, userId: actor.userId } }, create: { threadId, userId: actor.userId, readAt: message.createdAt }, update: { readAt: message.createdAt } });
  });
}

/** Counts conversations with a newer public reply, using the same current-participant boundary as /messages. */
export async function unreadProblemThreadCount(db: Pick<PrismaClient, "supportThread">, userId: string) {
  const rows = await db.supportThread.findMany({
    where: { jobParticipants: true, job: { is: { OR: [{ customerId: userId }, { workerId: userId }] } } },
    select: { reads: { where: { userId }, select: { readAt: true } }, messages: { where: { internal: false }, orderBy: { createdAt: "desc" }, take: 1, select: { authorId: true, createdAt: true } } },
  });
  return rows.filter(row => { const last = row.messages[0]; return last && last.authorId !== userId && (!row.reads[0] || row.reads[0].readAt < last.createdAt); }).length;
}

export async function getMessages(db: PrismaClient, actor: Actor, selectedId?: string, signPhoto?: (path: string) => Promise<string>): Promise<MessagesData> {
  const role = await currentRole(db, actor);
  const access: Prisma.JobWhereInput = role === "ADMIN" ? {} : { OR: [{ customerId: actor.userId }, { workerId: actor.userId }] };
  const [rows, jobs] = await Promise.all([
    db.supportThread.findMany({ where: { jobParticipants: true, job: { is: access } }, orderBy: { lastMessageAt: "desc" },
      include: { job: { select: JOB_SELECT }, reads: true, messages: { where: { internal: false }, orderBy: { createdAt: "desc" }, take: 1 } } }),
    db.job.findMany({ where: access, orderBy: { updatedAt: "desc" }, select: { id: true, jobNumber: true, title: true, workerId: true } }),
  ]);
  const selected = selectedId ? rows.find(row => row.id === selectedId) : null;
  if (selectedId && !selected) throw new ProblemThreadError("forbidden");
  const summaries = rows.map(row => {
    const claimed = !!row.job?.workerId;
    const last = row.messages[0]; const read = row.reads.find(r => r.userId === actor.userId)?.readAt;
    return { id: row.id, subject: redactContactDetails(row.subject, claimed), jobNumber: `TM-${row.job!.jobNumber}`, title: redactContactDetails(row.job!.title, claimed), preview: last ? redactContactDetails(last.body, claimed) : "", when: time(row.lastMessageAt), unread: !!last && last.authorId !== actor.userId && (!read || read < last.createdAt) };
  });
  let view: MessagesData["selected"] = null;
  if (selected?.job) {
    const job = selected.job; const claimed = !!job.workerId;
    const [messages, history, variations] = await Promise.all([
      db.supportMessage.findMany({ where: { threadId: selected.id, internal: false }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { author: { select: { firstName: true, lastName: true } }, photos: { orderBy: { position: "asc" } } } }),
      db.jobStatusHistory.findMany({ where: { jobId: job.id, toStatus: { in: ["BOOKABLE", "ASSIGNED", "SUBMITTED", "COMPLETED"] } }, orderBy: { createdAt: "asc" } }),
      db.variation.findMany({ where: { jobId: job.id }, select: { id: true, status: true, createdAt: true, updatedAt: true } }),
    ]);
    const sign = signPhoto ?? (async path => createSupabaseFileStore().signedUrl(PHOTO_BUCKET, path, SIGNED_URL_SECONDS));
    const labels = { BOOKABLE: "Paid", ASSIGNED: "Job booked", SUBMITTED: "Work finished", COMPLETED: "Job completed" };
    view = { id: selected.id, subject: redactContactDetails(selected.subject, claimed), closed: selected.status === "CLOSED",
      job: { id: job.id, number: `TM-${job.jobNumber}`, title: redactContactDetails(job.title, claimed), suburb: job.suburb, status: job.status, worker: job.worker ? name(job.worker) : null },
      messages: await Promise.all(messages.map(async message => ({ id: message.id, author: message.fromOffice ? "Trade Marketplace" : message.author ? name(message.author) : "Former member", office: message.fromOffice, own: message.authorId === actor.userId,
        body: redactContactDetails(message.body, claimed), at: message.createdAt.toISOString(), when: time(message.createdAt),
        photos: await Promise.all(message.photos.map(async photo => { try { return { id: photo.id, url: await sign(photo.path) }; } catch { return { id: photo.id, url: null }; } })),
        seen: selected.reads.some(read => read.userId !== actor.userId && [job.customerId, job.workerId].includes(read.userId) && read.readAt >= message.createdAt),
      }))),
      events: [...history.map(h => ({ id: h.id, label: labels[h.toStatus as keyof typeof labels], at: h.createdAt.toISOString() })), ...variations.map(v => ({ id: v.id, label: v.status === "APPROVED" ? "Extra work approved" : v.status === "DECLINED" ? "Extra work declined" : "Extra work requested", at: v.createdAt.toISOString() }))].sort((a, b) => a.at.localeCompare(b.at)),
    };
  }
  return { role, viewerId: actor.userId, threads: summaries, selected: view, jobs: jobs.map(job => ({ id: job.id, number: `TM-${job.jobNumber}`, title: redactContactDetails(job.title, !!job.workerId) })) };
}
