import { describe, expect, it } from "vitest";
import { exampleJob, VIEWERS } from "@/app/dev/components/job-views/preview-data";
import { workerClaimView } from "@/server/jobs/worker-claim-reader";
const needs = { cocRequired: true, minPhotos: 0, notesRequired: false };
describe("worker claim serialization", () => {
  it("shows the frozen worker earnings and priced materials without exposing customer pricing or private data", () => {
    const source = exampleJob({ status: "BOOKABLE", workerId: null });
    const view = workerClaimView(VIEWERS.worker, source, needs)!;
    expect(view.earn).toEqual({ cents: 18900, rateCents: 7000, minutes: 150, holidayPay: true });
    expect(view.budgetCents).toBe(12000); expect(view.needs).toEqual({ coc: true, photos: 0, notes: false });
    expect(view).toMatchObject({ customerFirstName: "Sarah", address: null, customerPhone: null, assignedToYou: false });
    const wire = JSON.stringify(view);
    for (const value of ["priceCents", "onCost", "margin", "gst", "37200", "Thompson", "sarah@example.test", "0210000001", "1 Example Street", "Office-only", "Another worker", "My estimate", "15000"]) expect(wire).not.toContain(value);
    expect(Object.keys(view).sort()).toEqual(["id", "jobNumber", "title", "description", "category", "suburb", "city", "customerFirstName", "assignedToYou", "customerPhone", "address", "asap", "anyTime", "timeWindows", "earn", "budgetCents", "needs"].sort());
  });
  it("prefers the actual materials budget, including zero, and never recalculates frozen pay", () => {
    const source = exampleJob({ status: "BOOKABLE", workerId: null });
    source.pricing = { ...source.pricing!, workerRateCents: 1234, workerGrossCents: 5555, holidayPayCents: 111, materialsCents: 2222 };
    const view = workerClaimView(VIEWERS.worker, { ...source, materials: { budgetCents: 0 } }, null)!;
    expect(view.budgetCents).toBe(0); expect(view.earn).toEqual({ cents: 5666, minutes: 150, rateCents: 1234, holidayPay: true }); expect(view.needs).toBeNull();
  });
  it("keeps missing/legacy pricing and unpriced statuses out of the claim screen", () => {
    expect(workerClaimView(VIEWERS.worker, exampleJob({ status: "BOOKABLE", workerId: null, pricing: null }), needs)).toBeNull();
    expect(workerClaimView(VIEWERS.worker, exampleJob({ status: "REVIEW", workerId: null }), needs)).toBeNull();
    expect(workerClaimView(VIEWERS.worker, exampleJob({ status: "PRICED", workerId: null }), needs)).toBeNull();
  });
  it("unlocks address/phone only for the current assignee, preserving role and revocation boundaries", () => {
    const source = exampleJob();
    expect(workerClaimView(VIEWERS.worker, source, needs)).toMatchObject({ assignedToYou: true, customerPhone: "0210000001", address: { line1: "1 Example Street" } });
    for (const viewer of [VIEWERS.customer, VIEWERS.office]) expect(workerClaimView(viewer, source, needs)).toBeNull();
    expect(workerClaimView(VIEWERS.worker, { ...source, workerId: "another-worker" }, needs)).toBeNull();
    expect(workerClaimView(VIEWERS.worker, { ...source, status: "CANCELLED" }, needs)).toBeNull();
    const publicJob = exampleJob({ status: "BOOKABLE", workerId: null }); publicJob.customer.firstName = "021 123 4567 private@example.test";
    expect(workerClaimView(VIEWERS.worker, publicJob, needs)?.customerFirstName).not.toMatch(/123 4567|private@example/);
  });
});
