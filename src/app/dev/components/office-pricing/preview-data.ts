import "server-only";
import { exampleJob, VIEWERS } from "@/app/dev/components/job-views/preview-data";
import type { PriceFields, PricingWorkspace } from "@/lib/office-pricing";
import { type PricingRates, priceWork } from "@/server/pricing/calculate";
import { estimateStatistics, previewPrice } from "@/server/office/pricing-read";

export const PRICE_STATES = ["ready", "no-estimates", "site-visit", "loading", "error", "offline", "confirm", "photos", "sent", "frozen", "long", "changed"] as const;
export type PriceState = typeof PRICE_STATES[number];
export const DEMO_RATES: PricingRates = { workerRateCents: 7000, minMinutes: 120, holidayPayBps: 800, onCostBps: 1250, marginBps: 2000, gstBps: 1500 };
const estimates = [
  { name: "Jack W", record: "4.9 ★ · 32 jobs", minutes: 210, materialsCents: 8500, note: "Probably a cooked switch" },
  { name: "Aroha K", record: "4.7 ★ · 18 jobs", minutes: 240, materialsCents: 11000, note: null },
  { name: "Ben L", record: "new", minutes: 180, materialsCents: 6000, note: null },
  { name: "Priya S", record: "4.8 ★ · 40 jobs", minutes: 270, materialsCents: 9500, note: "Might need a new circuit" },
  { name: "Sam T", record: "4.6 ★ · 9 jobs", minutes: 210, materialsCents: 8000, note: null },
];
export function pricingExample(state: PriceState = "ready", invalid = false): { source: ReturnType<typeof exampleJob>; data: PricingWorkspace; fieldErrors?: Partial<Record<keyof PriceFields, string>> } {
  const now = new Date("2026-11-03T00:00:00Z"), frozen = state === "frozen";
  const source = exampleJob({ status: frozen ? "PRICED" : "REVIEW", workerId: null, worker: null, priceCents: null, pricing: null,
    title: state === "long" ? "Replace all the guttering, downpipes and rotten fascia boards on a two-storey villa, and take the old ones away" : "Sub wiring",
    description: "Lights in the lounge keep flickering and the switch is getting warm. Pretty sure some wires behind it are exposed.", asap: true,
    estimates: state === "no-estimates" ? [] : estimates.map((row, index) => ({ ...row, id: `example-${index}`, workerId: `worker-${index}`, createdAt: now, updatedAt: now, madeBeforeEdit: state === "long" && index === 4, needsSiteVisit: state === "site-visit" && index === 0 })),
  });
  const stats = estimateStatistics(source.estimates), fields = invalid ? { hours: "check", materials: "85.00" } : frozen ? { hours: "4", materials: "85.00" } : stats.fields;
  if (frozen) {
    const b = priceWork({ minutes: 240, materialsCents: 8500 }, DEMO_RATES);
    source.priceCents = b.customerPriceCents;
    source.pricing = { ...DEMO_RATES, minutes: b.minutes, materialsCents: b.materialsCents, workerGrossCents: b.workerGrossCents, holidayPayCents: b.holidayPayCents, onCostCents: b.onCostCents, marginCents: b.marginCents, gstCents: b.gstCents, note: null, pricedById: VIEWERS.office.userId, pricedAt: now, updatedAt: now };
  }
  const result = previewPrice(source, fields, DEMO_RATES);
  const data: PricingWorkspace = { id: source.id, number: "TM-1005", title: source.title, trade: "Electrical", suburb: "Windsor", description: source.description, accessNotes: "Use the side gate.", status: source.status, posted: state === "no-estimates" ? "26h" : "2h", asap: true, canPrice: !frozen,
    photos: state === "no-estimates" ? [] : [{ src: "/images/examples/large/wires.jpg", alt: "Exposed wiring" }, { src: "/images/examples/large/switch.jpg", alt: "Light switch" }], photosFailed: state === "changed",
    estimates: source.estimates.map((row, index) => ({ id: row.id, name: state === "long" ? "Wiremu Hēnare-Fitzgerald-MacPherson" : estimates[index].name, record: estimates[index].record, hours: `${row.minutes / 60} h`, materials: new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(row.materialsCents / 100), note: row.note, stale: row.madeBeforeEdit, needsSiteVisit: row.needsSiteVisit })),
    spread: stats.spread, suggestion: stats.suggestion, trimmed: stats.trimmed, siteVisitRequested: state === "site-visit", noEstimatesAfterDay: state === "no-estimates", fields, preview: "ok" in result ? null : result };
  const fieldErrors = invalid && "ok" in result && (result.field === "hours" || result.field === "materials") ? { [result.field]: result.message } : undefined;
  return { source, data, fieldErrors };
}
export function previewExample(raw: unknown, state: PriceState) {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}, fields: PriceFields = { hours: typeof value.hours === "string" ? value.hours : "", materials: typeof value.materials === "string" ? value.materials : "" };
  const result = previewPrice(pricingExample(state).source, fields, DEMO_RATES);
  return "ok" in result ? result : { ok: true as const, preview: result };
}
