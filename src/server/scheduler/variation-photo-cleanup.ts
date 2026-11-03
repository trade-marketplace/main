import "server-only";
import { PHOTO_BUCKET, createSupabaseFileStore, type FileStore } from "@/server/files/storage";
import type { SchedulerRule } from "./rules";

/** Retains attached photos; unique keys mean an ambiguous old delete can never delete a later upload. */
export function variationPhotoCleanup(store: () => Pick<FileStore, "remove"> = createSupabaseFileStore): SchedulerRule {
  return { name: "variation-photo-cleanup", async run({ db, now, limit }) {
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const due = await db.variationPhoto.findMany({ where: { variationId: null, createdAt: { lte: cutoff } }, orderBy: [{ createdAt: "asc" }, { path: "asc" }], take: Math.min(limit, 10) });
    const result = { rule: "variation-photo-cleanup", due: due.length, done: 0, skipped: 0, failed: 0 };
    for (const photo of due) {
      try {
        const outcome = await db.$transaction(async tx => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`variation-photos:${photo.jobId}`}, 0))`;
          const current = await tx.variationPhoto.findUnique({ where: { path: photo.path } });
          if (!current || current.variationId || current.createdAt > cutoff) return "skipped" as const;
          // Durable tombstone: a timed-out remote delete must never race a later attachment.
          await db.variationPhoto.updateMany({ where: { path: current.path, variationId: null }, data: { deleting: true } });
          // Deleting the durable row happens only after Storage confirms removal; failures remain retryable.
          if (current.path.startsWith(`variations/${current.jobId}/${current.uploadedById}/`) && /\/[0-9a-f]{32}\.webp$/.test(current.path)) await store().remove(PHOTO_BUCKET, [current.path]);
          await tx.variationPhoto.delete({ where: { path: photo.path } });
          return "done" as const;
        }, { timeout: 30_000 });
        result[outcome]++;
      } catch { result.failed++; console.error("Variation photo cleanup unavailable."); }
    }
    return result;
  } };
}
