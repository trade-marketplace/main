import "server-only";
import { getLicenceStaging, STAGE_CLEANUP_GRACE_MS, type LicenceStaging } from "@/server/account/licence-upload";
import type { SchedulerRule } from "./rules";

/** Finalized and abandoned uploads both stay tracked until their signed upload token can no longer be used.
 * Delete the raw object again after expiry, then drop its record. A failed deletion remains due for retry. */
export function licenceUploadCleanup(staging: () => LicenceStaging = getLicenceStaging): SchedulerRule {
  return {
    name: "licence-upload-cleanup",
    async run({ db, now, limit }) {
      const due = await db.licenceUploadStage.findMany({ where: { expiresAt: { lte: new Date(now.getTime() - STAGE_CLEANUP_GRACE_MS) } }, orderBy: [{ expiresAt: "asc" }, { id: "asc" }], take: limit });
      const result = { rule: "licence-upload-cleanup", due: due.length, done: 0, skipped: 0, failed: 0 };
      for (const record of due) {
        try {
          await staging().remove(record.path);
          const deleted = await db.licenceUploadStage.deleteMany({ where: { id: record.id, expiresAt: record.expiresAt } });
          result[deleted.count ? "done" : "skipped"]++;
        } catch { result.failed++; console.error("Licence staging cleanup unavailable."); }
      }
      return result;
    },
  };
}
