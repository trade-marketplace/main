import "server-only";
import type { PriceFields } from "@/lib/office-pricing";
import type { VariationPricingData } from "@/lib/office-variation";
import { variationPricePreview, type VariationPricingSource } from "@/server/office/variation-read";

export const VARIATION_STATES = ["ready", "empty", "loading", "error", "offline", "confirm", "sent", "approved", "declined", "long", "changed", "payment-pending"] as const;
export type VariationState = typeof VARIATION_STATES[number];
export function variationExample(state: VariationState = "ready") {
  const source: VariationPricingSource = {
    id: "16900000-0000-4000-8000-000000000001", jobId: "16900000-0000-4000-8000-000000000002", requestedById: "16900000-0000-4000-8000-000000000003",
    description: state === "long" ? "Replace the second cracked switch in the downstairs hallway and check the exposed wires behind the old plate before fitting the replacement." : "Replace the second cracked switch",
    requestedBy: { firstName: "Jack", lastName: "Williams" }, requestedMinutes: 30, requestedMaterialsCents: 1000,
    status: state === "approved" ? "APPROVED" : state === "declined" ? "DECLINED" : state === "payment-pending" ? "PRICED" : "REQUESTED", revision: state === "payment-pending" ? 1 : 0,
    minutes: null, materialsCents: null, priceCents: null, gstCents: null, workerGrossCents: null, holidayPayCents: null, onCostCents: null, marginCents: null,
    photos: [], job: { id: "16900000-0000-4000-8000-000000000002", jobNumber: 1005, title: "Sub wiring", category: "ELECTRICAL", suburb: "Windsor", status: "ASSIGNED", customerId: "customer", workerId: "worker",
      pricing: { workerRateCents: 7000, minMinutes: 120, holidayPayBps: 800, onCostBps: 1250, marginBps: 2000, gstBps: 1500 } },
  };
  const fields = { hours: "0.5", materials: "10.00" }, result = variationPricePreview(source, fields);
  const data: VariationPricingData = { id: source.id, jobId: source.jobId, number: "TM-1005", title: source.job.title, trade: "Electrical", suburb: source.job.suburb,
    description: source.description, requester: state === "long" ? "Wiremu Hēnare-Fitzgerald-MacPherson" : "Jack W", requestedHours: "0.5 h", requestedMaterials: "$10.00", status: source.status, revision: source.revision,
    canPrice: !["APPROVED", "DECLINED"].includes(source.status), fields, preview: "ok" in result ? null : result, photosFailed: state === "changed",
    photos: state === "empty" || state === "changed" ? [] : [{ src: "/images/examples/large/switch.jpg", alt: "Cracked switch" }, { src: "/images/examples/large/wires.jpg", alt: "Exposed wiring" }] };
  return { source, data };
}
export function previewVariationExample(raw: unknown, state: VariationState) {
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const fields: PriceFields = { hours: typeof input.hours === "string" ? input.hours : "", materials: typeof input.materials === "string" ? input.materials : "" };
  const result = variationPricePreview(variationExample(state).source, fields);
  return "ok" in result ? result : { ok: true as const, preview: result };
}
