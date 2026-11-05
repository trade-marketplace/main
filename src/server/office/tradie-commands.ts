import "server-only";
import { createHash } from "node:crypto";
import type { Licence, PrismaClient } from "@/generated/prisma/client";
import { tradieDecisionSchema, type TradieDecisionResult } from "@/lib/office-tradies";
import { licenceToday } from "@/lib/account/trades";
import { lockLicenceDocuments } from "@/server/account/licence-documents";
import { createAudit } from "@/server/audit/audit";
import { createNotify } from "@/server/notifications/notify";
import { recordWorkerCheck } from "@/server/workers/office-checks";

export function licenceReviewVersion(row: Pick<Licence, "id" | "number" | "expiresOn" | "documentPath" | "updatedAt" | "status" | "checkedAt" | "checkedById">): string {
  return createHash("sha256").update(JSON.stringify([row.id, row.number, row.expiresOn, row.documentPath, row.updatedAt, row.status, row.checkedAt, row.checkedById])).digest("hex");
}
class DecisionError extends Error { constructor(readonly code: "forbidden" | "stale" | "expiry") { super(code); } }
export async function decideTradie(db: PrismaClient, actor: { userId: string }, raw: unknown, now = new Date()): Promise<TradieDecisionResult> {
  const parsed = tradieDecisionSchema.safeParse(raw); if (!parsed.success || !Number.isFinite(now.getTime())) return { ok: false, error: "invalid" };
  const input = parsed.data;
  try {
    if (input.kind === "pause" || input.kind === "unpause") {
      await recordWorkerCheck(db, actor, input.userId, { kind: input.kind === "pause" ? "paused" : "unpaused", reason: input.note, expectedPausedAt: input.expectedPausedAt }, now);
    } else if (input.kind === "approve" || input.kind === "reject") await db.$transaction(async tx => {
      // Use the existing office capability lock, then the same document lock as worker resubmissions/cleanup.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(178, 1)`;
      const office = await tx.profile.findUnique({ where: { id: actor.userId }, select: { role: true } });
      if (office?.role !== "ADMIN") throw new DecisionError("forbidden");
      await lockLicenceDocuments(tx, input.userId);
      const worker = await tx.profile.findUnique({ where: { id: input.userId }, select: { role: true } });
      if (worker?.role !== "TRADIE") throw new DecisionError("forbidden");
      const before = await tx.licence.findUnique({ where: { userId_trade: { userId: input.userId, trade: input.trade } } });
      if (!before || before.status !== "PENDING" || licenceReviewVersion(before) !== input.version) throw new DecisionError("stale");
      if (input.kind === "approve" && (!before.expiresOn || before.expiresOn.toISOString().slice(0, 10) < licenceToday(now))) throw new DecisionError("expiry");
      const after = await tx.licence.update({ where: { id: before.id }, data: { status: input.kind === "approve" ? "VERIFIED" : "REJECTED", checkedAt: now, checkedById: actor.userId, rejectionReason: input.kind === "reject" ? input.reason : null } });
      const action = input.kind === "approve" ? "licence.verified" : "licence.rejected";
      await createAudit(tx)(actor, action, { type: "licences", id: before.id }, { status: before.status, checkedAt: before.checkedAt, checkedById: before.checkedById, rejectionReason: before.rejectionReason }, { status: after.status, checkedAt: after.checkedAt, checkedById: after.checkedById, rejectionReason: after.rejectionReason }, input.note);
      await createNotify(tx)(action, [input.userId], { eventId: `${action}:${before.id}:${input.version}` });
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof DecisionError) return { ok: false, error: error.code };
    if (error instanceof Error && ["office-access-required", "worker-required"].includes(error.message)) return { ok: false, error: "forbidden" };
    if (error instanceof Error && error.message === "worker-check-changed") return { ok: false, error: "stale" };
    console.error("Tradie decision could not be saved."); return { ok: false, error: "unavailable" };
  }
}
