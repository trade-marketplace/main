import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { createSupabaseFileStore, PHOTO_BUCKET, type FileStore } from "@/server/files/storage";
import type { SchedulerRule } from "@/server/scheduler/rules";

export const SUPPORT_PHOTO_GRACE_MS = 24 * 60 * 60 * 1000;
export function lockSupportPhoto(tx: Prisma.TransactionClient, path: string) {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`support-photo:${path}`}, 0))`;
}

/** Intent commits before Storage receives bytes, so an upload or later attachment rollback stays collectable.
 * Upload, attachment, and cleanup share the same path lock. Random upload paths are never recreated. */
export async function putSupportPhoto(db: PrismaClient, files: FileStore, path: string, bytes: Uint8Array) {
  await db.supportPhotoCleanup.create({ data: { path } });
  await db.$transaction(async tx => { await lockSupportPhoto(tx, path); await files.put(PHOTO_BUCKET, path, bytes, "image/webp"); }, { timeout: 30_000 });
}

export function supportPhotoCleanup(files: () => Pick<FileStore, "remove"> = createSupabaseFileStore): SchedulerRule {
  return {
    name: "support-photo-cleanup",
    async run({ db, now, limit }) {
      const cutoff = new Date(now.getTime() - SUPPORT_PHOTO_GRACE_MS);
      const due = await db.supportPhotoCleanup.findMany({ where: { createdAt: { lte: cutoff } }, orderBy: [{ createdAt: "asc" }, { path: "asc" }], take: Math.min(limit, 10) });
      const result = { rule: "support-photo-cleanup", due: due.length, done: 0, skipped: 0, failed: 0 };
      for (const record of due) {
        try {
          if (!/^support\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[a-f0-9]{32}\.webp$/i.test(record.path)) {
            await db.supportPhotoCleanup.deleteMany({ where: { path: record.path } }); result.skipped++; continue;
          }
          // Persist this tombstone before remote deletion. Even an ambiguous Storage failure must prevent a
          // new attachment from racing an in-flight delete; retries keep the intent until deletion succeeds.
          await db.supportPhotoCleanup.updateMany({ where: { path: record.path, createdAt: { lte: cutoff } }, data: { deleting: true } });
          const outcome = await db.$transaction(async tx => {
            await lockSupportPhoto(tx, record.path);
            const pending = await tx.supportPhotoCleanup.findUnique({ where: { path: record.path } });
            if (!pending || pending.createdAt > cutoff) return "skipped" as const;
            if (await tx.supportMessagePhoto.count({ where: { path: record.path } })) {
              await tx.supportPhotoCleanup.delete({ where: { path: record.path } }); return "skipped" as const;
            }
            await files().remove(PHOTO_BUCKET, [record.path]);
            await tx.supportPhotoCleanup.delete({ where: { path: record.path } }); return "done" as const;
          }, { timeout: 30_000 });
          result[outcome]++;
        } catch { result.failed++; console.error("Support photo cleanup unavailable."); }
      }
      return result;
    },
  };
}
