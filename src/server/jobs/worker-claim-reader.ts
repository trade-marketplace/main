import "server-only";
import { pointBalance, pointLevels } from "@/server/points/ledger";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { redactContactDetails } from "@/lib/problem-threads";
import type { WorkerClaimView } from "@/lib/worker-claim";
import { JOB_DETAIL_SELECT, workerJobView, type JobViewer, type JobSource } from "@/server/views";
import { eligibilityFailure, WORKER_ELIGIBILITY_SELECT } from "@/server/workers/eligibility";

export const WORKER_CLAIM_SELECT = { ...JOB_DETAIL_SELECT, materials: { select: { budgetCents: true } } } satisfies Prisma.JobSelect;
type ClaimSource = JobSource & { materials?: { budgetCents: number } | null };
type Needs = { cocRequired: boolean; minPhotos: number; notesRequired: boolean } | null;

/** Apply #95 first, then explicitly allowlist the worker-only claim fields. No ORM spread reaches the browser. */
export function workerClaimView(viewer: JobViewer, source: ClaimSource, needs: Needs): WorkerClaimView | null {
  const safe = workerJobView(viewer, source), pricing = source.pricing;
  if (!safe || !pricing || safe.earnCents === null || (source.status !== "BOOKABLE" && !safe.assignedToYou)) return null;
  return {
    id: safe.id, jobNumber: safe.jobNumber, title: safe.title, description: safe.description, category: safe.category,
    suburb: safe.suburb, city: safe.city, customerFirstName: redactContactDetails(source.customer.firstName, safe.assignedToYou),
    assignedToYou: safe.assignedToYou, customerPhone: safe.customer?.phone ?? null, address: safe.address,
    asap: safe.asap, anyTime: safe.anyTime, timeWindows: safe.timeWindows,
    earn: { cents: safe.earnCents, minutes: pricing.minutes, rateCents: pricing.workerRateCents, holidayPay: pricing.holidayPayCents > 0 },
    budgetCents: source.materials?.budgetCents ?? pricing.materialsCents,
    needs: needs ? { coc: needs.cocRequired, photos: needs.minPhotos, notes: needs.notesRequired } : null,
  };
}

export async function loadWorkerClaim(db: Pick<PrismaClient, "job" | "tradeEvidenceRule" | "profile" | "settings" | "pointEntry">, viewer: JobViewer, id: string) {
  if (viewer.role !== "TRADIE") return null;
  const source = await db.job.findUnique({ where: { id }, select: WORKER_CLAIM_SELECT });
  if (!source || !workerJobView(viewer, source)) return null;
  const needs = await db.tradeEvidenceRule.findUnique({ where: { trade: source.category }, select: { cocRequired: true, minPhotos: true, notesRequired: true } });
  const job = workerClaimView(viewer, source, needs); if (!job) return null;
  if (job.assignedToYou) return { job, photoCount: source.photos.length, failure: null, points: null };
  const [worker, settings] = await Promise.all([
    db.profile.findUnique({ where: { id: viewer.userId }, select: WORKER_ELIGIBILITY_SELECT }),
    db.settings.findUnique({ where: { id: 1 }, select: { enabledTrades: true } }),
  ]);
  const levels = await pointLevels(db);
  const points = { balance: await pointBalance(db, viewer.userId, levels), cost: levels.claim };
  return { job, photoCount: source.photos.length, failure: eligibilityFailure(worker, source, "claim", { enabledTrades: settings?.enabledTrades }), points };
}
