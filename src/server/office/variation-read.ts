import "server-only";
import { createHash } from "node:crypto";
import { notFound } from "next/navigation";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { inputKey, UUID, type PriceFields, type PricingPreview } from "@/lib/office-pricing";
import { money } from "@/lib/office-job";
import { jobNumberLabel, TRADE_LABELS } from "@/lib/office-jobs";
import type { VariationPricingData, VariationPricingFailure } from "@/lib/office-variation";
import type { JobViewer } from "@/server/views";
import { priceWork, type PriceBreakdown, type PricingRates } from "@/server/pricing/calculate";
import { createSupabaseFileStore } from "@/server/files/storage";
import { variationPhotoUrls } from "@/server/variations/photos";
import { readPriceFields } from "./pricing-read";
import { shortName } from "./jobs";

export type VariationPricingDatabase = Pick<PrismaClient, "profile" | "variation">;
export const VARIATION_PRICING_SELECT = {
  id: true, jobId: true, description: true, status: true, revision: true, requestedById: true,
  requestedMinutes: true, requestedMaterialsCents: true, minutes: true, materialsCents: true,
  priceCents: true, gstCents: true, workerGrossCents: true, holidayPayCents: true, onCostCents: true, marginCents: true,
  requestedBy: { select: { firstName: true, lastName: true } },
  photos: { where: { ready: true, deleting: false }, orderBy: { position: "asc" }, take: 6, select: { path: true, position: true } },
  job: { select: { id: true, jobNumber: true, title: true, category: true, suburb: true, status: true, customerId: true, workerId: true,
    pricing: { select: { workerRateCents: true, minMinutes: true, holidayPayBps: true, onCostBps: true, marginBps: true, gstBps: true } } } },
} satisfies Prisma.VariationSelect;
export type VariationPricingSource = Prisma.VariationGetPayload<{ select: typeof VARIATION_PRICING_SELECT }>;
export function requireVariationOffice(viewer: JobViewer) { if (!viewer.userId || viewer.role !== "ADMIN") notFound(); }
export async function readVariationSource(db: VariationPricingDatabase, viewer: JobViewer, id: string) {
  requireVariationOffice(viewer);
  if (!UUID.test(id)) return null;
  // The current database role protects reads after an office session was removed.
  if ((await db.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } }))?.role !== "ADMIN") notFound();
  return db.variation.findUnique({ where: { id }, select: VARIATION_PRICING_SELECT });
}
export function canPriceVariation(source: VariationPricingSource) {
  return source.job.status === "ASSIGNED" && ["REQUESTED", "PRICED"].includes(source.status) && !!source.job.pricing;
}
export function variationPricePreview(source: VariationPricingSource, fields: PriceFields): PricingPreview | VariationPricingFailure {
  const parsed = readPriceFields(fields); if (!parsed.ok) return { ...parsed, error: "invalid", field: parsed.field === "hours" || parsed.field === "materials" ? parsed.field : undefined };
  if (parsed.minutes > 6000) return { ok: false, error: "invalid", field: "hours", message: "Enter no more than 100 hours." };
  const rates = source.job.pricing;
  if (!rates) return { ok: false, error: "changed" };
  try { return format(source, fields, rates, priceWork(parsed, rates, { applyMinimum: false })); }
  catch { return { ok: false, error: "invalid", field: "hours", message: "Check the hours and materials. This price is too large." }; }
}
function format(source: VariationPricingSource, fields: PriceFields, rates: PricingRates, price: PriceBreakdown): PricingPreview {
  const token = createHash("sha256").update(JSON.stringify({ id: source.id, status: source.status, revision: source.revision,
    description: source.description, requestedById: source.requestedById, photos: source.photos,
    request: [source.requestedMinutes, source.requestedMaterialsCents],
    job: { id: source.jobId, status: source.job.status, workerId: source.job.workerId, title: source.job.title, suburb: source.job.suburb }, rates, fields, price })).digest("hex");
  return { token, inputKey: inputKey(fields), exGst: money(price.exGstCents), gst: money(price.gstCents), total: money(price.customerPriceCents),
    workerEarns: money(price.workerEarnsCents), materials: money(price.materialsCents), margin: money(price.marginCents), gstLabel: `GST (${rates.gstBps / 100}%)`, minimum: null,
    customer: { title: source.description, suburb: source.job.suburb, total: money(price.customerPriceCents), gst: money(price.gstCents) } };
}
function storedPreview(source: VariationPricingSource, fields: PriceFields): PricingPreview | null {
  const rates = source.job.pricing;
  if (!rates || source.minutes === null || source.materialsCents === null || source.workerGrossCents === null || source.holidayPayCents === null
    || source.onCostCents === null || source.marginCents === null || source.gstCents === null || source.priceCents === null) return null;
  return format(source, fields, rates, { minutes: source.minutes, materialsCents: source.materialsCents, workerGrossCents: source.workerGrossCents,
    holidayPayCents: source.holidayPayCents, onCostCents: source.onCostCents, marginCents: source.marginCents, gstCents: source.gstCents,
    customerPriceCents: source.priceCents, exGstCents: source.priceCents - source.gstCents,
    labourCostCents: source.workerGrossCents + source.holidayPayCents + source.onCostCents, workerEarnsCents: source.workerGrossCents + source.holidayPayCents });
}
const hours = (minutes: number) => (minutes / 60).toFixed(2).replace(/\.?0+$/, "");
type SignedPhoto = { position: number; url: string; expiresInSeconds: number };
export async function readVariationPricing(db: PrismaClient, viewer: JobViewer, id: string,
  sign: (id: string) => Promise<readonly SignedPhoto[]> = variationId => variationPhotoUrls(db, createSupabaseFileStore(), viewer, variationId)): Promise<VariationPricingData | null> {
  const source = await readVariationSource(db, viewer, id); if (!source) return null;
  const fields = { hours: hours(source.minutes ?? source.requestedMinutes), materials: ((source.materialsCents ?? source.requestedMaterialsCents) / 100).toFixed(2) };
  const canPrice = canPriceVariation(source), preview = canPrice ? variationPricePreview(source, fields) : storedPreview(source, fields);
  let photos: readonly SignedPhoto[] = [], photosFailed = false;
  if (source.photos.length) { try { photos = await sign(id); } catch { photosFailed = true; } }
  return { id: source.id, jobId: source.jobId, number: jobNumberLabel(source.job.jobNumber), title: source.job.title, trade: TRADE_LABELS[source.job.category], suburb: source.job.suburb,
    description: source.description, requester: shortName(source.requestedBy) ?? "—", requestedHours: `${hours(source.requestedMinutes)} h`, requestedMaterials: money(source.requestedMaterialsCents),
    status: source.status, revision: source.revision, canPrice, fields, preview: preview && !("ok" in preview) ? preview : null, photosFailed,
    photos: photos.map((photo, index) => ({ src: photo.url, alt: `${source.description} · ${index + 1}` })) };
}
