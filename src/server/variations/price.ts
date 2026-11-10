import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { createAudit } from "@/server/audit/audit";
import { createNotify } from "@/server/notifications/notify";
import { MAX_DB_INT, priceWork, PricingInputError } from "@/server/pricing/calculate";
import type { PaymentIntentsApi } from "@/server/payments/payments";
import { retireVariationPayments } from "@/server/payments/variation-payment";
import { command, inProgress, lockVariation, refuse, requireActor, type VariationActor } from "./common";

/** Optional office confirmation metadata makes the UI's retry the same audited send, not another revision. */
export type PriceConfirmation = { requestId: string; confirmationDigest: string; inputDigest: string };
export async function priceVariation(db: PrismaClient, actor: VariationActor, id: string, expectedRevision: number, minutes?: number, intents: PaymentIntentsApi | null = null, materialsCents?: number, confirmation?: PriceConfirmation) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0 || (minutes !== undefined && (!Number.isInteger(minutes) || minutes < 1 || minutes > 6000))
    || (materialsCents !== undefined && (!Number.isInteger(materialsCents) || materialsCents < 0 || materialsCents > MAX_DB_INT))) return { ok: false, error: "invalid" } as const;
  return command(db, async tx => {
    await requireActor(tx, actor, "ADMIN");
    const { job, variation } = await lockVariation(tx, id);
    inProgress(job.status);
    if (!["REQUESTED", "PRICED"].includes(variation.status) || variation.revision !== expectedRevision) return refuse("changed");
    const rates = await tx.jobPricing.findUnique({ where: { jobId: job.id } });
    if (!rates) return refuse("changed");
    let price;
    try { price = priceWork({ minutes: minutes ?? variation.minutes ?? variation.requestedMinutes, materialsCents: materialsCents ?? variation.materialsCents ?? variation.requestedMaterialsCents }, rates, { applyMinimum: false }); }
    catch (error) { if (error instanceof PricingInputError) return refuse("invalid"); throw error; }
    await retireVariationPayments(tx, intents, actor, variation.id);
    const updated = await tx.variation.update({ where: { id }, data: { status: "PRICED", revision: { increment: 1 }, minutes: price.minutes, materialsCents: price.materialsCents, workerGrossCents: price.workerGrossCents, holidayPayCents: price.holidayPayCents, onCostCents: price.onCostCents, marginCents: price.marginCents, gstCents: price.gstCents, priceCents: price.customerPriceCents, pricedById: actor.userId } });
    await createAudit(tx)(actor, "variation.priced", { type: "variations", id }, { status: variation.status, revision: variation.revision, priceCents: variation.priceCents, materialsCents: variation.materialsCents }, { status: "PRICED", revision: updated.revision, priceCents: updated.priceCents, minutes: updated.minutes, materialsCents: updated.materialsCents, ...confirmation });
    await createNotify(tx)("variation.priced", [job.customerId], { eventId: `variation.priced:${id}:${updated.revision}`, payload: { jobId: job.id, jobNumber: job.jobNumber, variationId: id } });
    return { ok: true, variationId: id, revision: updated.revision } as const;
  });
}
