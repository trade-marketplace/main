import { describe, expect, it } from "vitest";
import { estimateFields, ESTIMATE_ELIGIBILITY_MESSAGES, workerEstimateSchema } from "@/lib/worker-estimate";
import { workerJobView } from "@/server/views/jobs";
import { exampleJob, VIEWERS } from "@/app/dev/components/job-views/preview-data";
const input = { hours: "3.5", materials: "85.00", note: "  A cooked switch.  ", needsSiteVisit: true };
describe("blind estimate input", () => {
  it("uses whole cents, half-hour steps, and an explicit office-only note", () => {
    expect(workerEstimateSchema.parse(input)).toEqual({ hours: 3.5, materials: 8500, note: "A cooked switch.", needsSiteVisit: true });
    for (const hours of ["0.5", "40"]) expect(workerEstimateSchema.safeParse({ ...input, hours }).success).toBe(true);
    expect(workerEstimateSchema.parse({ ...input, materials: "0" }).materials).toBe(0);
  });
  it.each(["", "0", "0.25", "1.2", "40.5", "Infinity", "-1", "1e1"])("rejects invalid hours %j", hours => {
    expect(workerEstimateSchema.safeParse({ ...input, hours }).success).toBe(false);
  });
  it.each(["", "-1", "0.001", "NaN", "21474836.48", "1e4"])("rejects invalid money %j", materials => {
    expect(workerEstimateSchema.safeParse({ ...input, materials }).success).toBe(false);
  });
  it("does not accept a forged worker/job id or oversized note", () => {
    for (const extra of [{ workerId: VIEWERS.office.userId }, { jobId: "other" }, { note: "a".repeat(2001) }]) expect(workerEstimateSchema.safeParse({ ...input, ...extra }).success).toBe(false);
    expect(estimateFields(null)).toEqual({ hours: "0.5", materials: "0.00", note: "", needsSiteVisit: false });
  });
});
describe("D04 worker read boundary", () => {
  it("returns only the first name and count alongside the viewer’s own estimate", () => {
    const source = exampleJob({ status: "REVIEW", workerId: null });
    const safe = workerJobView(VIEWERS.worker, source)!;
    expect(safe).toMatchObject({ customerFirstName: "Sarah", estimateCount: 2, address: null, customer: null, earnCents: null, ownEstimate: { note: "My estimate" } });
    const wire = JSON.stringify(safe);
    for (const privateValue of [source.addressLine1, source.customer.lastName!, source.customer.email!, source.customer.phone!, "Another worker's private estimate", "priceCents", "workerRateCents", "margin", "15000", "300"]) expect(wire).not.toContain(privateValue);
    expect(Object.keys(safe).sort()).toEqual(["address", "anyTime", "asap", "assignedToYou", "bookedDate", "bookedTime", "category", "city", "createdAt", "customer", "customerFirstName", "description", "earnCents", "estimateCount", "id", "jobNumber", "ownEstimate", "photos", "point", "precision", "status", "suburb", "timeWindows", "title", "updatedAt"].sort());
    source.customer.firstName = "021 123 4567 private@example.test";
    expect(workerJobView(VIEWERS.worker, source)?.customerFirstName).not.toMatch(/123 4567|private@example/);
  });
  it("retains the central role access boundary and an explanation for every eligibility reason", () => {
    expect(workerJobView(VIEWERS.customer, exampleJob())).toBeNull();
    expect(workerJobView(VIEWERS.worker, exampleJob({ workerId: "other-worker" }))).toBeNull();
    expect(Object.values(ESTIMATE_ELIGIBILITY_MESSAGES).every(value => value.length > 0)).toBe(true);
  });
});
