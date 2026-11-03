import type { Trade } from "@/generated/prisma/client";
import type { WorkerVerification } from "@/server/workers/verification";
export const PREVIEW_NOW = new Date("2026-11-03T00:00:00Z");
export const VERIFIED_STATES = ["verified", "email-unconfirmed", "phone-unconfirmed", "phone-changed", "id-unchecked", "checking", "rejected", "expired", "unchecked-trade", "paused", "other"] as const;
export type VerifiedState = typeof VERIFIED_STATES[number];

/** Local examples only. Private proof fields are evaluated on the server and never passed into cards. */
export function verificationExample(state: string): { worker: WorkerVerification; trade: Trade } {
  const checkedAt = new Date("2026-10-01T00:00:00Z");
  const trade: Trade = state === "other" ? "OTHER" : state === "unchecked-trade" ? "PLUMBING" : "ELECTRICAL";
  const worker: WorkerVerification = {
    id: "22222222-2222-4222-8222-222222222136", role: "TRADIE", email: "worker@example.test", emailVerifiedAt: checkedAt,
    phone: "+64210000002", phoneVerifiedFor: "+64210000002", phoneVerifiedAt: checkedAt,
    workerProfile: { identityCheckedAt: checkedAt, identityCheckedById: "office-example", pausedAt: null },
    workerTrades: [{ trade: state === "other" ? "OTHER" : "ELECTRICAL", licence: state === "other" ? null : { status: "VERIFIED", checkedAt, checkedById: "office-example", expiresOn: new Date("2027-11-03T00:00:00Z") } }],
  };
  if (state === "email-unconfirmed") worker.emailVerifiedAt = null;
  if (state === "phone-unconfirmed") { worker.phoneVerifiedAt = null; worker.phoneVerifiedFor = null; }
  if (state === "phone-changed") worker.phone = "+64210000003";
  if (state === "id-unchecked") worker.workerProfile!.identityCheckedAt = null;
  if (state === "paused") worker.workerProfile!.pausedAt = checkedAt;
  const licence = worker.workerTrades[0].licence;
  if (licence && state === "checking") licence.status = "PENDING";
  if (licence && state === "rejected") licence.status = "REJECTED";
  if (licence && state === "expired") licence.expiresOn = new Date("2026-11-02T00:00:00Z");
  return { worker, trade };
}
