import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { createAudit } from "@/server/audit/audit";
import { createNotify } from "@/server/notifications/notify";
import { startPayment, type PaymentIntentsApi } from "@/server/payments/payments";
import { paymentFailure } from "@/lib/payments/results";
import { retireVariationPayments } from "@/server/payments/variation-payment";
import { command, inProgress, isUuid, lockVariation, refuse, requireActor, type VariationActor } from "./common";

/** Approval starts checkout; only verified settlement changes PRICED to APPROVED. */
export async function approveVariation(db: PrismaClient, actor: VariationActor, id: string, expectedRevision: number, intents: PaymentIntentsApi | null = null) {
  if (!isUuid(id) || !Number.isInteger(expectedRevision) || expectedRevision < 0) return { ok: false, error: "invalid" } as const;
  const variation = await db.variation.findUnique({ where: { id }, select: { jobId: true } });
  if (!variation) return paymentFailure("not-found");
  return startPayment(db, intents, actor.userId, { jobId: variation.jobId, variationId: id, variationRevision: expectedRevision });
}

export async function declineVariation(db: PrismaClient, actor: VariationActor, id: string, expectedRevision: number, intents: PaymentIntentsApi | null = null) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) return { ok: false, error: "invalid" } as const;
  return command(db, async tx => {
    await requireActor(tx, actor, "CUSTOMER");
    const { job, variation } = await lockVariation(tx, id);
    if (job.customerId !== actor.userId) return refuse("not-found");
    if (variation.status === "DECLINED" && variation.revision === expectedRevision) return { ok: true, variationId: id } as const;
    inProgress(job.status);
    if (variation.status !== "PRICED" || variation.revision !== expectedRevision) return refuse("changed");
    await retireVariationPayments(tx, intents, actor, id);
    await tx.variation.update({ where: { id }, data: { status: "DECLINED" } });
    await createAudit(tx)(actor, "variation.declined", { type: "variations", id }, { status: "PRICED" }, { status: "DECLINED" });
    if (job.workerId) await createNotify(tx)("variation.declined", [job.workerId], { eventId: `variation.declined:${id}`, payload: { jobId: job.id, jobNumber: job.jobNumber, variationId: id } });
    return { ok: true, variationId: id } as const;
  });
}
