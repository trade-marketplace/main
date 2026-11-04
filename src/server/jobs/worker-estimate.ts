import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { workerEstimateSchema, type EstimateResult } from "@/lib/worker-estimate";
import type { JobViewer } from "@/server/views";
import { saveEligibleEstimate, WorkerEligibilityError } from "@/server/workers/eligibility-mutations";

/** Browser fields are validated here; identity and eligibility always come from the current server viewer. */
export async function submitWorkerEstimate(db: PrismaClient, viewer: JobViewer, id: string, input: unknown): Promise<EstimateResult> {
  if (viewer.role !== "TRADIE") return { status: "ineligible", failure: "worker-required" };
  if (!z.uuid().safeParse(id).success) return { status: "ineligible", failure: "not-open" };
  const parsed = workerEstimateSchema.safeParse(input);
  if (!parsed.success) {
    const fields: Partial<Record<"hours" | "materials" | "note" | "needsSiteVisit", string>> = {};
    for (const issue of parsed.error.issues) {
      const name = issue.path[0];
      if (name === "hours") fields.hours = "Use half-hour steps from 0.5 to 40.";
      else if (name === "materials") fields.materials = "Enter a materials cost of $0 or more.";
      else if (name === "note") fields.note = "Keep your note to 2,000 characters.";
    }
    return { status: "invalid", fields };
  }
  const data = { minutes: parsed.data.hours * 60, materialsCents: parsed.data.materials, note: parsed.data.note || null, needsSiteVisit: parsed.data.needsSiteVisit };
  try {
    const saved = await saveEligibleEstimate(db, viewer, id, data);
    return { status: "saved", estimate: { ...data, madeBeforeEdit: false }, pointsAwarded: saved.pointsAwarded, points: saved.points };
  } catch (error) {
    if (error instanceof WorkerEligibilityError) return { status: "ineligible", failure: error.failure };
    return { status: "unavailable" };
  }
}
