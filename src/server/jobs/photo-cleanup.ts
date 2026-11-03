import "server-only";
import { createSupabaseFileStore, PHOTO_BUCKET, type FileStore } from "@/server/files/storage";
import type { SchedulerRule } from "@/server/scheduler/rules";
import { ownsDraftPhoto } from "./draft-photos";
import { DRAFT_PHOTO_CLEANUP_MS, DRAFT_PHOTO_RAW_GRACE_MS, getPhotoStaging, lockPhotoDraft, type PhotoStaging } from "./photo-upload";

export function draftPhotoRawCleanup(staging: () => PhotoStaging = getPhotoStaging): SchedulerRule {
  return { name: "draft-photo-raw-cleanup", async run({ db, now, limit }) {
    const cutoff = new Date(now.getTime() - DRAFT_PHOTO_RAW_GRACE_MS);
    const due = await db.draftPhotoStage.findMany({ where: { expiresAt: { lte: cutoff } }, orderBy: [{ expiresAt: "asc" }, { path: "asc" }], take: Math.min(limit, 10) });
    const result = { rule: "draft-photo-raw-cleanup", due: due.length, done: 0, skipped: 0, failed: 0 };
    for (const record of due) {
      try { await staging().remove(record.path); await db.draftPhotoStage.deleteMany({ where: { path: record.path, expiresAt: { lte: cutoff } } }); result.done++; }
      catch { result.failed++; console.error("Draft photo raw cleanup unavailable."); }
    }
    return result;
  } };
}

/** Retain intents while referenced, checking them later so active drafts cannot starve abandoned-file cleanup. */
export function draftPhotoCleanup(files: () => Pick<FileStore, "remove"> = createSupabaseFileStore): SchedulerRule {
  return { name: "draft-photo-cleanup", async run({ db, now, limit }) {
    const due = await db.draftPhotoCleanup.findMany({ where: { checkAfter: { lte: now } }, orderBy: [{ checkAfter: "asc" }, { path: "asc" }], take: Math.min(limit, 10) });
    const result = { rule: "draft-photo-cleanup", due: due.length, done: 0, skipped: 0, failed: 0 };
    for (const record of due) {
      try {
        const mayDelete = await db.$transaction(async tx => {
          await lockPhotoDraft(tx, record.userId);
          const current = await tx.draftPhotoCleanup.findUnique({ where: { path: record.path } });
          if (!current || current.checkAfter > now || !ownsDraftPhoto(record.userId, record.postKey, record.path)) return false;
          const row = await tx.jobDraft.findUnique({ where: { profileId: record.userId } });
          const data = row?.data;
          const referenced = data && typeof data === "object" && !Array.isArray(data) && Array.isArray(data.photoPaths) && data.photoPaths.includes(record.path);
          if (referenced || await tx.jobPhoto.count({ where: { path: record.path } })) {
            await tx.draftPhotoCleanup.update({ where: { path: record.path }, data: { checkAfter: new Date(now.getTime() + DRAFT_PHOTO_CLEANUP_MS) } });
            return false;
          }
          await tx.draftPhotoCleanup.update({ where: { path: record.path }, data: { deleting: true } });
          return true;
        });
        if (!mayDelete) { result.skipped++; continue; }
        // Commit the tombstone before remote deletion. A lost response must not permit a stale reattachment.
        const outcome = await db.$transaction(async tx => {
          await lockPhotoDraft(tx, record.userId);
          const current = await tx.draftPhotoCleanup.findUnique({ where: { path: record.path } });
          if (!current?.deleting) return "skipped" as const;
          await files().remove(PHOTO_BUCKET, [record.path]);
          await tx.draftPhotoCleanup.delete({ where: { path: record.path } });
          return "done" as const;
        }, { timeout: 30_000 });
        result[outcome]++;
      } catch { result.failed++; console.error("Draft photo cleanup unavailable."); }
    }
    return result;
  } };
}
