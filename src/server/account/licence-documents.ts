import "server-only";
import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import { createUploadService, type UploadDb } from "@/server/files/service";
import { DOCUMENT_BUCKET, type FileStore } from "@/server/files/storage";
import type { FileViewer } from "@/server/files/access";
import { MESSAGES, UploadError } from "@/server/files/errors";

/** Serializes final uploads/attachments with cleanup, including the same document reused by another trade. */
export async function lockLicenceDocuments(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`licence-documents:${userId}`}, 0))`;
}
export function isLicenceDocument(path: string, userId: string): boolean {
  return new RegExp(`^licences/${userId}/[0-9a-f]{32}\\.(pdf|webp)$`).test(path);
}

/** Called while saveTrade holds the owner's document lock. The independent client call commits the cleanup
 * intent BEFORE Storage put, so an audit/attachment rollback cannot strand a new final file. Cleanup waits for
 * that same lock, then keeps a committed reference or removes the unreferenced file. The generic upload service
 * still owns byte validation, PDF checking, image conversion and the final file type. This scoped wrapper assigns the stored object its unique owner-bound path. */
export function createLicenceDocumentUploader(db: PrismaClient, store: FileStore) {
  return async (viewer: FileViewer, bytes: Uint8Array): Promise<{ path: string }> => {
    let actualPath: string | null = null;
    await createUploadService({ db: db as unknown as UploadDb, store: {
      ...store,
      async put(bucket, path, input, contentType) {
        if (bucket !== DOCUMENT_BUCKET || !isLicenceDocument(path, viewer.userId)) throw new UploadError("not-allowed", MESSAGES.notAllowed);
        // Each upload gets a new key, including identical bytes. A delayed delete of an older document can
        // therefore never delete a newly uploaded document. Legacy/shared keys remain reference-protected.
        const extension = path.endsWith(".pdf") ? "pdf" : "webp";
        actualPath = `licences/${viewer.userId}/${randomBytes(16).toString("hex")}.${extension}`;
        await db.licenceDocumentCleanup.upsert({ where: { path: actualPath }, create: { path: actualPath, userId: viewer.userId }, update: {} });
        await store.put(bucket, actualPath, input, contentType);
      },
    } }).addDocument(viewer, "licences", bytes);
    if (!actualPath) throw new UploadError("storage-failed", MESSAGES.storageFailed);
    return { path: actualPath };
  };
}
