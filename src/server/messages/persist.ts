import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { ProblemThreadError } from "./errors";

export type PersistedMessageInput = { text: string; photoPaths: string[]; requestKey: string };

/** Both job conversations and private office support use the same immutable, idempotent message write. */
export async function persistSupportMessage(tx: Prisma.TransactionClient, actorId: string, threadId: string, data: PersistedMessageInput) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`support.message:${data.requestKey}`}, 0))`;
  const old = await tx.supportMessage.findUnique({ where: { requestKey: data.requestKey }, include: { photos: { orderBy: { position: "asc" } } } });
  if (old) {
    if (old.authorId !== actorId || old.threadId !== threadId) throw new ProblemThreadError("forbidden");
    if (old.body !== data.text || JSON.stringify(old.photos.map(photo => photo.path)) !== JSON.stringify(data.photoPaths)) throw new ProblemThreadError("invalid");
    return { messageId: old.id, created: false };
  }
  const message = await tx.supportMessage.create({ data: { threadId, authorId: actorId, body: data.text, requestKey: data.requestKey,
    photos: { create: data.photoPaths.map((path, position) => ({ path, position })) } } });
  return { messageId: message.id, created: true };
}
