import "server-only";

import { unstable_noStore as noStore } from "next/cache";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { licenceState, licenceToday, tradeLabel } from "@/lib/account/trades";
import { buildTradieSetup, type LicenceFact, type SetupFacts, type TradieSetupResult } from "@/lib/tradie-setup";
import { loadPayroll } from "@/server/account/payroll";
import { workerWorkArea, WORKER_ELIGIBILITY_SELECT } from "./eligibility";
import { hasCurrentTradeLicence, workerBasicProofFailure } from "./verification";

/** The eligibility read plus what only the checklist shows: the photo and the order trades were added in. */
export const WORKER_SETUP_SELECT = {
  ...WORKER_ELIGIBILITY_SELECT, avatarPath: true,
  workerTrades: { select: { ...WORKER_ELIGIBILITY_SELECT.workerTrades.select, createdAt: true }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.ProfileSelect;
export type SetupWorker = Prisma.ProfileGetPayload<{ select: typeof WORKER_SETUP_SELECT }>;

/**
 * One licence step for all restricted trades. "Done" is the shared claim rule (hasCurrentTradeLicence) for every
 * one of them; what is still open is worded like Trades & licences (licenceState). A rejected or expired licence
 * is the tradie's to fix, so it wins over one the office is still checking.
 */
export function licenceFact(worker: Pick<SetupWorker, "workerTrades">, now = new Date()): LicenceFact {
  const open = worker.workerTrades.filter(row => row.trade !== "OTHER" && !hasCurrentTradeLicence(worker, row.trade, now));
  if (!open.length) return worker.workerTrades.some(row => row.trade !== "OTHER") ? "done" : "none";
  const today = licenceToday(now);
  const states = open.map(row => licenceState({ trade: row.trade, licence: row.licence && { id: "", number: "", status: row.licence.status,
    expiresOn: row.licence.expiresOn?.toISOString().slice(0, 10) ?? null, rejectionReason: null, hasDocument: false } }, today));
  return states.includes("rejected") ? "rejected" : states.includes("expired") ? "expired" : "checking";
}

export function setupFacts(worker: SetupWorker, bankComplete: boolean, now = new Date()): SetupFacts {
  return { emailVerified: worker.emailVerifiedAt !== null, tradeLabels: worker.workerTrades.map(row => tradeLabel(row.trade)), licence: licenceFact(worker, now),
    bankComplete, hasPhoto: Boolean(worker.avatarPath), hasWorkArea: workerWorkArea(worker) !== null,
    // Same two gates as the board's own "blocked" answer (src/server/jobs/board.ts).
    canBrowse: workerBasicProofFailure(worker, now) === null && workerWorkArea(worker) !== null };
}

/** Fresh on every request: a step is done only while its saved proof says so. Outages never look like "all done". */
export async function loadTradieSetup(db: Pick<PrismaClient, "profile" | "payrollDetails">, userId: string, now = new Date()): Promise<TradieSetupResult> {
  noStore();
  try {
    const [worker, payroll] = await Promise.all([db.profile.findUnique({ where: { id: userId }, select: WORKER_SETUP_SELECT }), loadPayroll(db, userId)]);
    if (!worker || worker.role !== "TRADIE") return { ok: false };
    return { ok: true, setup: buildTradieSetup(setupFacts(worker, payroll.complete, now), now) };
  } catch { console.error("Tradie setup unavailable."); return { ok: false }; }
}
