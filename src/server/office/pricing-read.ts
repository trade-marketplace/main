import "server-only";
import { createHash } from "node:crypto";
import { notFound } from "next/navigation";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { inputKey, UUID, type PriceFields, type PricingFailure, type PricingPreview, type PricingWorkspace } from "@/lib/office-pricing";
import { money, parseHoursToMinutes, parseMoneyToCents } from "@/lib/office-job";
import { jobNumberLabel, TRADE_LABELS } from "@/lib/office-jobs";
import { JOB_DETAIL_SELECT, officeJobView, type JobViewer } from "@/server/views";
import { getUploadService, type SignedPhoto } from "@/server/files/service";
import { type PriceBreakdown, type PricingRates, priceWork, ratesForTrade } from "@/server/pricing/calculate";
import { shortName } from "./jobs";

export type PricingDatabase = Pick<PrismaClient, "job" | "settings" | "estimate" | "review">;
export const PRICING_SELECT = { ...JOB_DETAIL_SELECT } satisfies Prisma.JobSelect;
export type PricingSource = Prisma.JobGetPayload<{ select: typeof PRICING_SELECT }>;
export type PricingSnapshotSource = Pick<PricingSource, "id" | "status" | "category" | "editedAt" | "pricing" | "priceCents" | "title" | "description" | "addressLine1" | "addressLine2" | "suburb" | "city" | "accessNotes" | "photos">;
export const canPublishPrice = (status: string) => ["REVIEW", "QUOTE_BOUNTY"].includes(status);
export function requirePricingOffice(viewer: JobViewer) { if (!viewer.userId || viewer.role !== "ADMIN") notFound(); }
export async function loadPricingSource(db: PricingDatabase, viewer: JobViewer, id: string) {
  requirePricingOffice(viewer); if (!UUID.test(id)) return null;
  return db.job.findUnique({ where: { id }, select: PRICING_SELECT });
}
export function readPriceFields(raw: unknown): { ok: true; fields: PriceFields; minutes: number; materialsCents: number } | PricingFailure {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const hours = typeof value.hours === "string" ? value.hours : "", materials = typeof value.materials === "string" ? value.materials : "";
  if (hours.length > 32 || materials.length > 32) return { ok: false, error: "invalid", field: "hours", message: "Check the hours and materials." };
  const minutes = parseHoursToMinutes(hours), materialsCents = parseMoneyToCents(materials);
  if (minutes === null || minutes < 1) return { ok: false, error: "invalid", field: "hours", message: "Enter the hours as a number above zero." };
  if (materialsCents === null) return { ok: false, error: "invalid", field: "materials", message: "Enter the materials at cost, ex GST, as an amount." };
  return { ok: true, fields: { hours, materials }, minutes, materialsCents };
}
export async function pricingRates(db: Pick<PricingDatabase, "settings">, job: PricingSource): Promise<PricingRates> {
  const stored = job.pricing;
  if (stored) return { workerRateCents: stored.workerRateCents, minMinutes: stored.minMinutes, holidayPayBps: stored.holidayPayBps, onCostBps: stored.onCostBps, marginBps: stored.marginBps, gstBps: stored.gstBps };
  return ratesForTrade(job.category, await db.settings.findUniqueOrThrow({ where: { id: 1 } }));
}
export function previewPrice(job: PricingSnapshotSource, fields: PriceFields, rates: PricingRates): PricingPreview | PricingFailure {
  const parsed = readPriceFields(fields); if (!parsed.ok) return parsed;
  try { return formatPricingPreview(job, fields, rates, priceWork(parsed, rates)); }
  catch { return { ok: false, error: "invalid", field: "hours", message: "Check the hours and materials. This price is too large." }; }
}
function formatPricingPreview(job: PricingSnapshotSource, fields: PriceFields, rates: PricingRates, breakdown: PriceBreakdown): PricingPreview {
  const token = createHash("sha256").update(JSON.stringify({ job: job.id, status: job.status, category: job.category, editedAt: job.editedAt?.toISOString(), draft: job.pricing, draftPriceCents: job.priceCents, content: { title: job.title, description: job.description, addressLine1: job.addressLine1, addressLine2: job.addressLine2, suburb: job.suburb, city: job.city, accessNotes: job.accessNotes, photos: job.photos }, rates, fields, breakdown })).digest("hex");
  return { inputKey: inputKey(fields), token, exGst: money(breakdown.exGstCents), gst: money(breakdown.gstCents), total: money(breakdown.customerPriceCents), workerEarns: money(breakdown.workerEarnsCents), materials: money(breakdown.materialsCents), margin: money(breakdown.marginCents),
    gstLabel: `GST (${rates.gstBps / 100}%)`, minimum: breakdown.minutes > (readPriceFields(fields) as { minutes: number }).minutes ? `${hoursLabel(rates.minMinutes)} minimum applies.` : null,
    customer: { title: job.title, suburb: job.suburb, total: money(breakdown.customerPriceCents), gst: money(breakdown.gstCents) } };
}
function savedPreview(job: PricingSource, fields: PriceFields, rates: PricingRates) {
  const p = job.pricing; if (!p || job.priceCents === null) return null;
  return formatPricingPreview(job, fields, rates, { minutes: p.minutes, materialsCents: p.materialsCents, workerGrossCents: p.workerGrossCents,
    holidayPayCents: p.holidayPayCents, onCostCents: p.onCostCents, labourCostCents: p.workerGrossCents + p.holidayPayCents + p.onCostCents,
    marginCents: p.marginCents, exGstCents: job.priceCents - p.gstCents, gstCents: p.gstCents, customerPriceCents: job.priceCents, workerEarnsCents: p.workerGrossCents + p.holidayPayCents });
}
const hoursLabel = (minutes: number) => `${new Intl.NumberFormat("en-NZ", { maximumFractionDigits: 2 }).format(minutes / 60)} h`;
const inputHours = (minutes: number) => (minutes / 60).toFixed(2).replace(/\.?0+$/, "");
export function estimateStatistics(estimates: readonly { minutes: number; materialsCents: number; madeBeforeEdit: boolean; needsSiteVisit: boolean }[]) {
  const current = estimates.filter(row => !row.madeBeforeEdit && !row.needsSiteVisit), trimmed = current.length >= 3;
  const average = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b), used = trimmed ? sorted.slice(1, -1) : sorted; return Math.round(used.reduce((a, b) => a + b, 0) / used.length); };
  if (!current.length) return { fields: { hours: "", materials: "0.00" }, suggestion: null, spread: null, trimmed: false };
  const minutes = average(current.map(row => row.minutes)), materialsCents = average(current.map(row => row.materialsCents));
  return { fields: { hours: inputHours(minutes), materials: (materialsCents / 100).toFixed(2) }, suggestion: `${hoursLabel(minutes)} · ${money(materialsCents)}`, trimmed,
    spread: `${hoursLabel(Math.min(...current.map(row => row.minutes)))}–${hoursLabel(Math.max(...current.map(row => row.minutes)))} · ${money(Math.min(...current.map(row => row.materialsCents)))}–${money(Math.max(...current.map(row => row.materialsCents)))}` };
}
export async function readPricingWorkspace(db: PricingDatabase, viewer: JobViewer, id: string, now = new Date(), signPhotos = (jobId: string) => getUploadService().jobPhotoUrls(viewer, jobId)): Promise<PricingWorkspace | null> {
  const source = await loadPricingSource(db, viewer, id); if (!source) return null;
  const job = officeJobView(viewer, source); if (!job) return null;
  const workers = [...new Set(job.estimates.map(row => row.workerId))];
  const [estimates, completed, reviews, rates] = await Promise.all([
    db.estimate.findMany({ where: { jobId: id }, select: { id: true, worker: { select: { firstName: true, lastName: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    workers.length ? db.job.groupBy({ by: ["workerId"], where: { workerId: { in: workers }, status: "COMPLETED" }, _count: { _all: true } }) : [],
    workers.length ? db.review.groupBy({ by: ["workerId"], where: { workerId: { in: workers }, hiddenAt: null }, _avg: { rating: true } }) : [],
    pricingRates(db, source),
  ]);
  let signed: SignedPhoto[] = [], photosFailed = false;
  if (job.photos.length) { try { signed = await signPhotos(id); } catch { photosFailed = true; } }
  const stats = estimateStatistics(job.estimates), fields = source.pricing ? { hours: inputHours(source.pricing.minutes), materials: (source.pricing.materialsCents / 100).toFixed(2) } : canPublishPrice(job.status) ? stats.fields : { hours: "", materials: "" };
  const result = canPublishPrice(job.status) ? previewPrice(source, fields, rates) : savedPreview(source, fields, rates);
  return { id: job.id, number: jobNumberLabel(job.jobNumber), title: job.title, trade: TRADE_LABELS[job.category], suburb: job.suburb, description: job.description, accessNotes: job.address.accessNotes,
    status: job.status, posted: `${Math.max(0, Math.floor((now.getTime() - source.createdAt.getTime()) / 3_600_000))}h`, asap: job.asap, canPrice: canPublishPrice(job.status),
    photos: signed.map((photo, index) => ({ src: photo.url, alt: `${job.title} · ${index + 1}` })), photosFailed,
    estimates: estimates.flatMap(row => { const estimate = job.estimates.find(item => item.id === row.id); if (!estimate) return [];
      const count = completed.find(item => item.workerId === estimate.workerId)?._count._all ?? 0, rating = reviews.find(item => item.workerId === estimate.workerId)?._avg.rating;
      return [{ id: row.id, name: shortName(row.worker) ?? "—", record: rating ? `${rating.toFixed(1)} ★ · ${count} jobs` : count ? `${count} jobs` : "new", hours: hoursLabel(estimate.minutes), materials: money(estimate.materialsCents), note: estimate.note, stale: estimate.madeBeforeEdit, needsSiteVisit: estimate.needsSiteVisit }]; }),
    spread: stats.spread, suggestion: stats.suggestion, trimmed: stats.trimmed, fields, preview: result && !("ok" in result) ? result : null,
    siteVisitRequested: job.estimates.some(row => row.needsSiteVisit && !row.madeBeforeEdit), noEstimatesAfterDay: !job.estimates.some(row => !row.madeBeforeEdit) && now.getTime() - source.createdAt.getTime() >= 24 * 3_600_000 };
}
