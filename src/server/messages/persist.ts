import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { ProblemThreadError } from "./errors";

export type PersistedMessageInput = { text: string; photoPaths: string[]; requestKey: string };

export async function lockMessageReceipt(tx: Prisma.TransactionClient, actorId: string, target: { threadId: string } | { jobId: string }, data: PersistedMessageInput) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`support.message:${data.requestKey}`}, 0))`;
  const old = await tx.supportMessage.findUnique({ where: { requestKey: data.requestKey }, include: { photos: { orderBy: { position: "asc" } }, thread: { select: { jobId: true, jobParticipants: true } } } });
  if (old) {
    const sameTarget = "threadId" in target ? old.threadId === target.threadId : old.thread.jobParticipants && old.thread.jobId === target.jobId;
    if (old.authorId !== actorId || old.internal || !sameTarget) throw new ProblemThreadError("forbidden");
    if (old.body !== data.text || JSON.stringify(old.photos.map(photo => photo.path)) !== JSON.stringify(data.photoPaths)) throw new ProblemThreadError("invalid");
    return { messageId: old.id, threadId: old.threadId };
  }
  return null;
}

export async function createSupportMessage(tx: Prisma.TransactionClient, actorId: string, threadId: string, data: PersistedMessageInput) {
  const message = await tx.supportMessage.create({ data: { threadId, authorId: actorId, body: data.text, requestKey: data.requestKey,
    photos: { create: data.photoPaths.map((path, position) => ({ path, position })) } } });
  return message.id;
}

/** Both job conversations and private office support use the same immutable, idempotent message write. */
export async function persistSupportMessage(tx: Prisma.TransactionClient, actorId: string, threadId: string, data: PersistedMessageInput) {
  const prior = await lockMessageReceipt(tx, actorId, { threadId }, data);
  if (prior) return { messageId: prior.messageId, created: false };
  return { messageId: await createSupportMessage(tx, actorId, threadId, data), created: true };
}
