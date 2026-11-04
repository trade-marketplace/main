import "server-only";

import { unstable_noStore as noStore } from "next/cache";
import type { Prisma, PrismaClient, Trade } from "@/generated/prisma/client";
import { licenceToday } from "@/lib/account/trades";
import { normaliseMobile } from "@/lib/auth/signup";

/** Read current proofs on every request; never cache a badge or trust a stored generic verified flag. */
export const WORKER_VERIFICATION_SELECT = {
  id: true, role: true, email: true, emailVerifiedAt: true,
  phone: true, phoneVerifiedAt: true, phoneVerifiedFor: true,
  workerProfile: { select: { identityCheckedAt: true, identityCheckedById: true, pausedAt: true } },
  workerTrades: { select: { trade: true, licence: { select: { status: true, checkedAt: true, checkedById: true, expiresOn: true } } } },
} satisfies Prisma.ProfileSelect;
export type WorkerVerification = Prisma.ProfileGetPayload<{ select: typeof WORKER_VERIFICATION_SELECT }>;

type LicenceProof = NonNullable<WorkerVerification["workerTrades"][number]["licence"]>;
const provedAt = (at: Date | null, now: Date) => at instanceof Date && Number.isFinite(at.getTime()) && at.getTime() <= now.getTime();
export type WorkerBasicProof = Pick<WorkerVerification, "role" | "email" | "emailVerifiedAt" | "workerProfile">;
export type BasicProofFailure = "worker-required" | "email-required" | "identity-required" | "worker-paused";

/** Claim/discovery basics are deliberately broader than the badge: phone confirmation is badge-only. */
export function workerBasicProofFailure(worker: WorkerBasicProof | null | undefined, now = new Date()): BasicProofFailure | null {
  if (!worker || worker.role !== "TRADIE" || !Number.isFinite(now.getTime())) return "worker-required";
  if (!worker.workerProfile || !worker.workerProfile.identityCheckedById || !provedAt(worker.workerProfile.identityCheckedAt, now)) return "identity-required";
  if (worker.workerProfile.pausedAt !== null) return "worker-paused";
  if (typeof worker.email !== "string" || !worker.email.trim() || !provedAt(worker.emailVerifiedAt, now)) return "email-required";
  return null;
}

/** Unknown expiry or missing office-check metadata cannot prove a current restricted-trade licence. */
function currentLicence(licence: LicenceProof | null, now: Date): boolean {
  return Boolean(licence && licence.status === "VERIFIED" && licence.checkedById && provedAt(licence.checkedAt, now)
    && licence.expiresOn instanceof Date && Number.isFinite(licence.expiresOn.getTime()) && licence.expiresOn.toISOString().slice(0, 10) >= licenceToday(now));
}

export function hasCurrentTradeLicence(worker: Pick<WorkerVerification, "workerTrades">, trade: Trade, now = new Date()): boolean {
  return worker.workerTrades.some(row => row.trade === trade && currentLicence(row.licence, now));
}

/**
 * A per-trade badge describes only that selected trade. The generic profile badge requires every advertised
 * restricted trade to be checked, so one checked licence never lends its badge to another trade. This is a
 * badge decision, not the complete job-claim eligibility policy (#137).
 */
export function isVerified(worker: WorkerVerification | null | undefined, trade?: Trade, now = new Date()): boolean {
  if (!worker || workerBasicProofFailure(worker, now)) return false;
  if (typeof worker.phone !== "string" || !worker.phone || worker.phone !== normaliseMobile(worker.phone) || worker.phoneVerifiedFor !== worker.phone || !provedAt(worker.phoneVerifiedAt, now)) return false;
  if (!Array.isArray(worker.workerTrades)) return false;
  const trades = trade ? worker.workerTrades.filter(row => row.trade === trade) : worker.workerTrades;
  return trades.length > 0 && trades.every(row => row.trade === "OTHER" || currentLicence(row.licence, now));
}

/** Fresh server read for presentation; data outages hide the badge and never expose proof details. */
export async function verifiedBadgeFor(db: Pick<PrismaClient, "profile">, userId: string, trade?: Trade, now = new Date()): Promise<boolean> {
  noStore();
  try { return isVerified(await db.profile.findUnique({ where: { id: userId }, select: WORKER_VERIFICATION_SELECT }), trade, now); }
  catch { console.error("Worker verification unavailable."); return false; }
}
