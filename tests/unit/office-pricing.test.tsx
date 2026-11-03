import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { pricingExample, DEMO_RATES } from "@/app/dev/components/office-pricing/preview-data";
import { exampleJob, VIEWERS } from "@/app/dev/components/job-views/preview-data";
import { OfficePricing } from "@/components/office/OfficePricing";
import { estimateStatistics, loadPricingSource, previewPrice, readPriceFields, readPricingWorkspace } from "@/server/office/pricing-read";
import { publishOfficePrice, readOfficePricePreview, requestPricingPhotos } from "@/server/office/pricing-commands";

vi.mock("next/navigation", async original => ({ ...(await original<typeof import("next/navigation")>()), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
function fixture(state: Parameters<typeof pricingExample>[0] = "ready") {
  const { source, data } = pricingExample(state);
  const db = { job: { findUnique: vi.fn(async () => source), groupBy: vi.fn(async () => [{ workerId: source.estimates[0]?.workerId, _count: { _all: 2 } }]) },
    settings: { findUniqueOrThrow: vi.fn(async () => ({ sharedRateCents: 7000, otherRateCents: 3800, sharedMinMinutes: 120, otherMinMinutes: 60, ...DEMO_RATES })) },
    estimate: { findMany: vi.fn(async () => source.estimates.map((row, index) => ({ id: row.id, worker: { firstName: index ? "Aroha" : "Jack", lastName: "Wilson" } }))) },
    review: { groupBy: vi.fn(async () => [{ workerId: source.estimates[0]?.workerId, _avg: { rating: 4.5 } }]) },
  };
  return { db, source, data };
}
const fields = { hours: "4", materials: "85.00" };
describe("office pricing input and descriptive estimate statistics", () => {
  it("trims one highest and lowest independently, excluding stale and site-visit-only estimates", () => {
    const { source } = pricingExample();
    expect(estimateStatistics(source.estimates)).toMatchObject({ trimmed: true, fields: { hours: "3.67", materials: "86.67" }, suggestion: "3.67 h · $86.67" });
    const extra = { ...source.estimates[0], minutes: 999, materialsCents: 999999 };
    expect(estimateStatistics([...source.estimates, { ...extra, madeBeforeEdit: true }, { ...extra, needsSiteVisit: true }])).toEqual(estimateStatistics(source.estimates));
    expect(estimateStatistics([])).toMatchObject({ suggestion: null, spread: null, fields: { hours: "", materials: "0.00" } });
    expect(estimateStatistics(source.estimates.slice(0, 2))).toMatchObject({ trimmed: false, fields: { hours: "3.75", materials: "97.50" } });
  });
  it("validates hours/materials on the server, with exact input units and bounded malformed values", () => {
    expect(readPriceFields({ hours: "2.5", materials: "1,234.56" })).toMatchObject({ ok: true, minutes: 150, materialsCents: 123456 });
    for (const hours of ["0", "-1", "NaN", "1e3", "a".repeat(100)]) expect(readPriceFields({ hours, materials: "1" })).toMatchObject({ ok: false, field: "hours" });
    for (const materials of ["-1", "1.999", "NaN", "Infinity"]) expect(readPriceFields({ hours: "2", materials })).toMatchObject({ ok: false, field: "materials" });
  });
  it("fingerprints the exact server snapshot, including edited content/photos even at the same timestamp", () => {
    const { source } = pricingExample(), original = previewPrice(source, fields, DEMO_RATES);
    expect(original).not.toHaveProperty("ok"); if ("ok" in original) throw new Error("valid preview required");
    expect(previewPrice(source, fields, DEMO_RATES)).toEqual(original);
    const variants = [previewPrice({ ...source, title: "Changed title" }, fields, DEMO_RATES), previewPrice({ ...source, photos: [] }, fields, DEMO_RATES), previewPrice(source, { ...fields, materials: "86.00" }, DEMO_RATES), previewPrice(source, fields, { ...DEMO_RATES, workerRateCents: 8000 })];
    for (const variant of variants) { expect(variant).not.toHaveProperty("ok"); if (!("ok" in variant)) expect(variant.token).not.toBe(original.token); }
    expect(Object.keys(original.customer).sort()).toEqual(["gst", "suburb", "title", "total"]);
    expect(JSON.stringify(original.customer)).not.toMatch(/worker|margin|estimate|hourly|rate|Office-only/);
  });
});
describe("the office pricing read and authorization boundary", () => {
  it("denies every customer/tradie reader or command before a database call", async () => {
    const { db, source } = fixture();
    const transactional = { $transaction: vi.fn() };
    for (const role of ["CUSTOMER", "TRADIE"] as const) {
      const viewer = { userId: "foreign", role };
      for (const read of [() => loadPricingSource(db as never, viewer, source.id), () => readOfficePricePreview(db as never, viewer, {}), () => publishOfficePrice(transactional as never, viewer, {}), () => requestPricingPhotos(transactional as never, viewer, {})]) await expect(read()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    }
    expect(db.job.findUnique).not.toHaveBeenCalled(); expect(transactional.$transaction).not.toHaveBeenCalled();
  });
  it("reads real track records/all estimates and signs only this job's private photos, without contacts/internal notes in the wire model", async () => {
    const { db, source } = fixture(), sign = vi.fn(async () => [{ id: "photo", position: 0, url: "https://private.example.test/signed?token=temporary", expiresInSeconds: 300 }]);
    const data = await readPricingWorkspace(db as never, VIEWERS.office, source.id, new Date("2026-11-03T02:00:00Z"), sign);
    expect(sign).toHaveBeenCalledWith(source.id);
    expect(data).toMatchObject({ canPrice: true, estimates: expect.arrayContaining([expect.objectContaining({ name: "Jack W", record: "4.5 ★ · 2 jobs" })]), photos: [{ src: "https://private.example.test/signed?token=temporary", alt: "Sub wiring · 1" }] });
    expect(data?.estimates).toHaveLength(5);
    expect(JSON.stringify(data)).not.toMatch(/sarah@example.test|0210000001|1 Example Street|Office-only|workerRateCents|onCostBps|customerId/);
  });
  it("keeps the workspace usable when private photo signing fails and allows pricing from photos after24h with no estimates", async () => {
    const { db, source } = fixture("no-estimates"); source.photos = [{ id: "photo", position: 0 }];
    const data = await readPricingWorkspace(db as never, VIEWERS.office, source.id, new Date("2026-11-04T02:00:00Z"), async () => { throw new Error("private storage detail"); });
    expect(data).toMatchObject({ canPrice: true, photosFailed: true, photos: [], estimates: [], noEstimatesAfterDay: true, preview: null });
    expect(JSON.stringify(data)).not.toContain("private storage detail");
  });
  it.each(["PRICED", "BOOKABLE", "ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW", "CANCELLED"] as const)("uses the immutable saved snapshot and no current settings for %s", async status => {
    const { db, source } = fixture(); Object.assign(source, { ...exampleJob({ status }), priceCents: 37200 });
    const data = await readPricingWorkspace(db as never, VIEWERS.office, source.id, new Date(), async () => []);
    expect(data).toMatchObject({ canPrice: false, preview: { total: "$372.00" } });
    expect(db.settings.findUniqueOrThrow).not.toHaveBeenCalled();
    const result = await readOfficePricePreview(db as never, VIEWERS.office, { jobId: source.id, ...fields });
    expect(result).toMatchObject({ ok: false, error: "frozen" });
  });
  it("never writes during preview and rejects a malformed/missing id without exposing raw errors", async () => {
    const { db, source } = fixture();
    expect(await readOfficePricePreview(db as never, VIEWERS.office, { jobId: source.id, ...fields })).toMatchObject({ ok: true, preview: { total: expect.stringMatching(/^\$/) } });
    db.job.findUnique.mockResolvedValueOnce(null as never);
    expect(await readOfficePricePreview(db as never, VIEWERS.office, { jobId: source.id, ...fields })).toMatchObject({ ok: false, error: "not-found" });
    expect(await loadPricingSource(db as never, VIEWERS.office, "not-a-uuid")).toBeNull();
  });
});
describe("pricing workspace states", () => {
  const submit = async () => ({ ok: true as const }), preview = async () => ({ ok: false as const, error: "unavailable" as const });
  it("renders real empty, failure, loading, frozen and future-visit states using the kit", () => {
    for (const state of ["ready", "no-estimates", "frozen"] as const) {
      const { data } = pricingExample(state), html = renderToStaticMarkup(<OfficePricing data={data} preview={preview} publish={submit} requestPhotos={submit} />);
      expect(html).toContain(state === "no-estimates" ? "No estimates yet" : state === "frozen" ? "read-only" : "Blind estimates");
    }
    expect(renderToStaticMarkup(<OfficePricing data={null} loading preview={preview} publish={submit} requestPhotos={submit} />)).toContain('aria-busy="true"');
    expect(renderToStaticMarkup(<OfficePricing data={null} preview={preview} publish={submit} requestPhotos={submit} />)).toContain("Can’t load this job");
    const { data } = pricingExample("site-visit");
    const html = renderToStaticMarkup(<OfficePricing data={data} initialDialog="visit" preview={preview} publish={submit} requestPhotos={submit} />);
    expect(html).toContain("Paid quick looks are coming soon"); expect(html).not.toContain("booked a visit");
  });
});
