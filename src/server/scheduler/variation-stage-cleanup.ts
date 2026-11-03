import "server-only";
import { getVariationStaging, VARIATION_STAGE_GRACE_MS, type VariationStaging } from "@/server/variations/staging";
import type { SchedulerRule } from "./rules";

export function variationStageCleanup(staging: () => VariationStaging = getVariationStaging): SchedulerRule {
  return { name: "variation-stage-cleanup", async run({ db, now, limit }) {
    const due = await db.variationUploadStage.findMany({ where: { expiresAt: { lte: new Date(now.getTime() - VARIATION_STAGE_GRACE_MS) } }, orderBy: [{ expiresAt: "asc" }, { id: "asc" }], take: Math.min(limit, 10) });
    const result = { rule: "variation-stage-cleanup", due: due.length, done: 0, skipped: 0, failed: 0 };
    for (const record of due) {
      try { await staging().remove(record.path); const deleted = await db.variationUploadStage.deleteMany({ where: { id: record.id, expiresAt: record.expiresAt } }); result[deleted.count ? "done" : "skipped"]++; }
      catch { result.failed++; console.error("Variation staging cleanup unavailable."); }
    }
    return result;
  } };
}
