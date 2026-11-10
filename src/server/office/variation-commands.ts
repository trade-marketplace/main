import "server-only";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { UUID } from "@/lib/office-pricing";
import { VARIATION_PRICING_MESSAGES, type VariationPricingFailure, type VariationPreviewResult, type VariationPublishResult } from "@/lib/office-variation";
import type { JobViewer } from "@/server/views";
import type { PaymentIntentsApi } from "@/server/payments/payments";
import { command, lockVariation, refuse, requireActor } from "@/server/variations/common";
import { priceVariation } from "@/server/variations/price";
import { readPriceFields } from "./pricing-read";
import { canPriceVariation, readVariationSource, requireVariationOffice, variationPricePreview, type VariationPricingDatabase } from "./variation-read";

const record = (raw: unknown): Record<string, unknown> => raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
const failure = (error: VariationPricingFailure["error"]): VariationPricingFailure => ({ ok: false, error, message: VARIATION_PRICING_MESSAGES[error] });
class Replayed extends Error {}
function parsedFields(raw: unknown) {
  const parsed = readPriceFields(raw);
  return parsed.ok ? parsed : { ...parsed, error: "invalid" as const, field: parsed.field === "hours" || parsed.field === "materials" ? parsed.field : undefined };
}
export async function readOfficeVariationPreview(db: VariationPricingDatabase, viewer: JobViewer, raw: unknown): Promise<VariationPreviewResult> {
  requireVariationOffice(viewer);
  const input = record(raw), id = typeof input.variationId === "string" ? input.variationId : "";
  const parsed = parsedFields(input); if (!parsed.ok) return parsed;
  const source = await readVariationSource(db, viewer, id); if (!source) return failure("not-found");
  if (!canPriceVariation(source)) return failure("not-in-progress");
  if (input.revision !== source.revision) return failure("changed");
  const preview = variationPricePreview(source, parsed.fields);
  return "ok" in preview ? preview : { ok: true, preview };
}

/** One outer transaction holds job/office capability locks through the canonical command and outbox write. */
export async function publishOfficeVariation(db: PrismaClient, viewer: JobViewer, raw: unknown, intents: PaymentIntentsApi | null = null): Promise<VariationPublishResult> {
  requireVariationOffice(viewer);
  const input = record(raw), id = typeof input.variationId === "string" ? input.variationId : "", requestId = typeof input.requestId === "string" ? input.requestId : "";
  if (!UUID.test(id) || !UUID.test(requestId) || typeof input.token !== "string" || !/^[a-f0-9]{64}$/.test(input.token) || !Number.isInteger(input.revision) || (input.revision as number) < 0) return failure("invalid");
  const parsed = parsedFields(input); if (!parsed.ok) return parsed;
  const digest = createHash("sha256").update(JSON.stringify({ revision: input.revision, fields: parsed.fields })).digest("hex");
  try { const result = await command(db, async tx => {
    await lockVariation(tx, id);
    // Same lock ordering as F02 and officeUsers: job first, then the office capability lock.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(178, 1)`;
    await requireActor(tx, viewer, "ADMIN");
    const replay = await tx.auditLog.findFirst({ where: { actorId: viewer.userId, action: "variation.priced", recordType: "variations", recordId: id,
      after: { path: ["requestId"], equals: requestId } }, select: { after: true } });
    if (replay) {
      const previous = record(replay.after);
      if (previous.confirmationDigest !== input.token || previous.inputDigest !== digest) return refuse("changed");
      // Roll back the lock write as well: a replay must not change the job's revision timestamp.
      throw new Replayed();
    }
    const source = await readVariationSource(tx, viewer, id); if (!source) return refuse("not-found");
    if (!canPriceVariation(source)) return refuse("not-in-progress");
    if (source.revision !== input.revision) return refuse("changed");
    const preview = variationPricePreview(source, parsed.fields);
    if ("ok" in preview) return refuse("invalid");
    if (preview.token !== input.token) return refuse("changed");
    // Reuse #158's pricing, payment-retirement, revision, audit and notification rules in this transaction.
    const facade = { $transaction: (run: (value: typeof tx) => unknown) => run(tx) } as unknown as PrismaClient;
    const priced = await priceVariation(facade, viewer, id, source.revision, parsed.minutes, intents, parsed.materialsCents,
      { requestId, confirmationDigest: preview.token, inputDigest: digest });
    if (!priced.ok) return refuse(priced.error);
    return { ok: true } as const;
  });
  return result.ok ? result : failure(result.error === "photos-pending" ? "changed" : result.error);
  } catch (error) { if (error instanceof Replayed) return { ok: true }; throw error; }
}
