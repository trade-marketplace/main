import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { normaliseMobile } from "@/lib/auth/signup";
import { createAudit } from "@/server/audit/audit";

type Actor = { userId: string };
type Change = { kind: "identity-checked" } | { kind: "phone-confirmed"; expectedPhone: string }
  | { kind: "paused"; reason: string; expectedPausedAt?: string | null } | { kind: "unpaused"; reason?: string; expectedPausedAt?: string | null };

/**
 * Server-only recording primitive for trusted checks, not a phone/ID checking mechanism or public action.
 * A future office workflow must establish the evidence before calling it. No legacy flag is accepted as proof.
 */
export async function recordWorkerCheck(db: PrismaClient, actor: Actor, userId: string, change: Change, now = new Date()): Promise<void> {
  if (!change || !["identity-checked", "phone-confirmed", "paused", "unpaused"].includes(change.kind)) throw new Error("invalid-worker-check");
  if (!Number.isFinite(now.getTime())) throw new Error("invalid-check-time");
  if (change.kind === "paused" && (typeof change.reason !== "string" || !change.reason.trim() || change.reason.length > 2000)) throw new Error("pause-reason-required");
  await db.$transaction(async tx => {
    // Same capability lock as officeUsers(): role revocation cannot pass the ADMIN check mid-write.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(178, 1)`;
    const administrator = await tx.profile.findUnique({ where: { id: actor.userId }, select: { role: true } });
    if (administrator?.role !== "ADMIN") throw new Error("office-access-required");
    const worker = await tx.profile.findUnique({ where: { id: userId }, select: { role: true, phone: true, phoneVerifiedAt: true, phoneVerifiedFor: true } });
    if (worker?.role !== "TRADIE") throw new Error("worker-required");
    if (change.kind === "phone-confirmed") {
      if (!change.expectedPhone || change.expectedPhone !== normaliseMobile(change.expectedPhone) || worker.phone !== change.expectedPhone) throw new Error("phone-changed");
      const saved = await tx.profile.updateMany({ where: { id: userId, role: "TRADIE", phone: change.expectedPhone }, data: { phoneVerifiedFor: change.expectedPhone, phoneVerifiedAt: now } });
      if (saved.count !== 1) throw new Error("phone-changed");
      await createAudit(tx)(actor, "worker.phone_confirmed", { type: "profiles", id: userId }, { phoneVerifiedAt: worker.phoneVerifiedAt }, { phoneVerifiedAt: now });
      return;
    }
    const before = await tx.workerProfile.findUniqueOrThrow({ where: { userId } });
    if ((change.kind === "paused" || change.kind === "unpaused") && change.expectedPausedAt !== undefined && change.expectedPausedAt !== (before.pausedAt?.toISOString() ?? null)) throw new Error("worker-check-changed");
    if (change.kind === "identity-checked") {
      await tx.workerProfile.update({ where: { userId }, data: { identityCheckedAt: now, identityCheckedById: actor.userId } });
      await createAudit(tx)(actor, "worker.identity_checked", { type: "worker_profiles", id: userId }, { identityCheckedAt: before.identityCheckedAt, identityCheckedById: before.identityCheckedById }, { identityCheckedAt: now, identityCheckedById: actor.userId });
    } else if (change.kind === "paused") {
      await tx.workerProfile.update({ where: { userId }, data: { pausedAt: now, pausedById: actor.userId } });
      await createAudit(tx)(actor, "worker.paused", { type: "worker_profiles", id: userId }, { pausedAt: before.pausedAt, pausedById: before.pausedById }, { pausedAt: now, pausedById: actor.userId }, change.reason);
    } else {
      if (!before.pausedAt) return;
      await tx.workerProfile.update({ where: { userId }, data: { pausedAt: null, pausedById: null } });
      await createAudit(tx)(actor, "worker.unpaused", { type: "worker_profiles", id: userId }, { pausedAt: before.pausedAt, pausedById: before.pausedById }, { pausedAt: null, pausedById: null }, change.reason);
    }
  });
}
