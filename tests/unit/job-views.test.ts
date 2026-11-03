import { renderToStaticMarkup } from "react-dom/server";
import JobViewsPreview from "@/app/dev/components/job-views/page";
import { describe, expect, it, vi } from "vitest";

import type { JobStatus, PrismaClient } from "@/generated/prisma/client";
import { exampleJob, jobViewExample, VIEWERS } from "@/app/dev/components/job-views/preview-data";
import { approximatePin } from "@/server/geo/approximate";
import { jobPinFor } from "@/server/geo/job-location";
import { customerJobView, customerJobsView, workerJobView, workerJobsView, officeJobView, officeJobsView, publicJobView, loadJobView, jobViewWhere, jobThreadContextView } from "@/server/views/jobs";
import { workerPayoutView, workerWaitingJobView } from "@/server/views/earnings";

const STATUSES: JobStatus[] = ["REVIEW", "QUOTE_BOUNTY", "PRICED", "BOOKABLE", "ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW", "CANCELLED"];
const CLAIMED = ["ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW"];
const OPEN = ["REVIEW", "QUOTE_BOUNTY", "BOOKABLE"];
const keys = (value: unknown): string[] => value && typeof value === "object" ? Object.entries(value).flatMap(([key, child]) => [key, ...keys(child)]) : [];

describe("job projections for every status", () => {
  it.each(STATUSES)("snapshots every role at %s", status => {
    const job = exampleJob({ status, workerId: CLAIMED.includes(status) || status === "CANCELLED" ? VIEWERS.worker.userId : null });
    expect({ customer: customerJobView(VIEWERS.customer, job), worker: workerJobView(VIEWERS.worker, job),
      otherWorker: workerJobView({ ...VIEWERS.worker, userId: "other-worker" }, job), office: officeJobView(VIEWERS.office, job), public: publicJobView() }).toMatchSnapshot();
  });

  it.each(STATUSES)("never serializes estimates, worker pay, averages or margins to customers at %s", status => {
    const view = customerJobView(VIEWERS.customer, exampleJob({ status }));
    expect(view).not.toBeNull();
    expect(keys(view).filter(key => /estimate|average|margin|workerGross|workerRate|holidayPay|onCost|earn|pricing/i.test(key))).toEqual([]);
    expect(JSON.stringify(view)).not.toContain("Office-only");
    expect(customerJobsView(VIEWERS.customer, [exampleJob({ status })])).toHaveLength(1);
  });

  it.each(STATUSES)("checks current assignment AND status before revealing address/phone at %s", status => {
    const job = exampleJob({ status }); // Deliberately retain a stale worker id even in pre-claim/cancelled states.
    const worker = workerJobView(VIEWERS.worker, job)!;
    expect(worker.address !== null).toBe(CLAIMED.includes(status));
    expect(worker.customer?.phone ?? null).toBe(CLAIMED.includes(status) ? job.customer.phone : null);
    expect(worker.point).toEqual(CLAIMED.includes(status) ? { lat: job.lat, lng: job.lng } : { lat: job.approxLat, lng: job.approxLng });
    expect(jobPinFor(job, VIEWERS.worker.userId)).toEqual(worker.point);
    expect(keys(worker).filter(key => /price|margin|gst|onCost|workerRate|customerId|email|estimates/i.test(key))).toEqual([]);
    expect(JSON.stringify(worker)).not.toContain("Another worker's private estimate");
    expect(customerJobView(VIEWERS.customer, job)?.worker?.phone).toBe(CLAIMED.includes(status) ? job.worker?.phone : null);
  });

  it.each(STATUSES)("does not reveal a private job to a different worker at %s", status => {
    const job = exampleJob({ status, workerId: "new-worker" });
    const view = workerJobView(VIEWERS.worker, job);
    if (OPEN.includes(status)) expect(view).toMatchObject({ address: null, customer: null, assignedToYou: false, precision: "approximate" });
    else expect(view).toBeNull();
  });
});

describe("revocation and explicit allowlists", () => {
  it("models the reassigned preview as a private assignment to someone else and renders the existing 404 view", async () => {
    const job = jobViewExample("worker-reassigned");
    expect(job.status).toBe("ASSIGNED");
    expect(job.workerId).not.toBe(VIEWERS.worker.userId);
    expect(job.worker?.id).toBe(job.workerId);
    expect(workerJobView(VIEWERS.worker, job)).toBeNull();
    expect(workerJobView({ ...VIEWERS.worker, userId: job.workerId! }, job)?.assignedToYou).toBe(true);
    const html = renderToStaticMarkup(await JobViewsPreview({ searchParams: Promise.resolve({ state: "worker-reassigned" }) }));
    expect(html).toContain("Wrong address.");
    for (const value of [job.title, job.addressLine1, job.customer.phone!, job.customer.email!, "View serialized data"]) expect(html).not.toContain(value);
    expect(workerJobView(VIEWERS.worker, jobViewExample("worker-unclaimed"))).toMatchObject({ assignedToYou: false, address: null });
  });
  it("redacts phone/email canaries in worker title/description before claim and after cancellation, preserving authorized originals", () => {
    const title = "Call +64 21 123 4567", description = "Contact private95@example.test or 021-765-4321";
    const assigned = exampleJob({ title, description });
    expect(workerJobView(VIEWERS.worker, assigned)).toMatchObject({ title, description });
    for (const status of ["REVIEW", "BOOKABLE", "CANCELLED"] as const) {
      const job = { ...assigned, status };
      const workerWire = JSON.stringify([workerJobView(VIEWERS.worker, job), workerJobsView(VIEWERS.worker, [job])]);
      expect(workerWire).not.toMatch(/private95@example.test|123 4567|765-4321/);
      expect(workerWire).toContain("hidden until the job is booked");
      expect(customerJobView(VIEWERS.customer, job)).toMatchObject({ title, description });
      expect(officeJobView(VIEWERS.office, job)).toMatchObject({ title, description });
    }
  });

  it("allows only current participants to read message job context, even for an otherwise public board job", () => {
    const job = exampleJob();
    expect(jobThreadContextView(VIEWERS.worker, job)).toEqual({ id: job.id, jobNumber: 1005, title: "Sub wiring", suburb: "Windsor", status: "ASSIGNED", worker: "Jack W" });
    expect(jobThreadContextView(VIEWERS.worker, { ...job, workerId: "replacement" })).toBeNull();
    expect(jobThreadContextView(VIEWERS.worker, { ...job, workerId: null, status: "BOOKABLE" })).toBeNull();
    expect(jobThreadContextView(VIEWERS.customer, { ...job, status: "CANCELLED" })?.worker).toBeNull();
    expect(keys(jobThreadContextView(VIEWERS.office, job)).filter(key => /price|phone|email|address|margin|estimate/i.test(key))).toEqual([]);
  });

  it("hides address and phone again immediately after losing the assignment, including list views", () => {
    const job = exampleJob();
    expect(workerJobView(VIEWERS.worker, job)?.customer?.phone).toBe(job.customer.phone);
    expect(workerJobView(VIEWERS.worker, { ...job, workerId: "new-worker" })).toBeNull();
    const reopened = { ...job, workerId: null, worker: null, status: "BOOKABLE" as const };
    expect(workerJobView(VIEWERS.worker, reopened)).toMatchObject({ address: null, customer: null, precision: "approximate" });
    expect(workerJobsView(VIEWERS.worker, [reopened])[0].point).toEqual({ lat: job.approxLat, lng: job.approxLng });
  });

  it("returns nothing for public, wrong-role, or foreign-customer access, even when the source contains extra secrets", () => {
    const job = Object.assign(exampleJob(), { password: "secret", averageMinutes: 200, serviceRoleKey: "secret", unexpected: "secret" });
    Object.assign(job.customer, { bankAccount: "secret" });
    Object.assign(job.pricing!, { unapprovedCalculation: "secret" });
    for (const view of [customerJobView(VIEWERS.customer, job), workerJobView(VIEWERS.worker, job), officeJobView(VIEWERS.office, job)]) expect(JSON.stringify(view)).not.toContain("secret");
    expect(customerJobView({ ...VIEWERS.customer, userId: "other" }, job)).toBeNull();
    expect(customerJobView(VIEWERS.office, job)).toBeNull();
    expect(workerJobView(VIEWERS.customer, job)).toBeNull();
    expect(officeJobView(VIEWERS.worker, job)).toBeNull();
    expect(customerJobView(null, job)).toBeNull();
    expect(workerJobView(null, job)).toBeNull();
    expect(officeJobView({ userId: "", role: "ADMIN" }, job)).toBeNull();
    expect(customerJobsView(VIEWERS.worker, [job])).toEqual([]);
    expect(workerJobsView(VIEWERS.customer, [job])).toEqual([]);
    expect(officeJobsView(null, [job])).toEqual([]);
  });

  it("uses only the same saved random pin on repeated reads", () => {
    const job = exampleJob({ status: "BOOKABLE", workerId: null });
    for (let read = 0; read < 20; read++) expect(workerJobView(VIEWERS.worker, job)?.point).toEqual({ lat: job.approxLat, lng: job.approxLng });
    for (const random of [0, 0.9999999999]) {
      const edge = approximatePin({ lat: job.lat!, lng: job.lng! }, () => random);
      expect(workerJobView(VIEWERS.worker, { ...job, approxLat: edge.lat, approxLng: edge.lng })?.point).toEqual(edge);
    }
  });

  it.each([{ approxLat: null, approxLng: null }, { approxLat: -46.3985, approxLng: 168.3695 }, { approxLat: 0, approxLng: 0 }, { approxLat: NaN, approxLng: Infinity }])("never falls back to the address for an absent/corrupt stored pin: %j", pin => {
    expect(workerJobView(VIEWERS.worker, exampleJob({ status: "BOOKABLE", workerId: null, ...pin }))?.point).toBeNull();
  });

  it("shows the worker's pay only when bookable or privately assigned; draft customer prices stay hidden", () => {
    const job = exampleJob();
    expect(workerJobView(VIEWERS.worker, { ...job, workerId: null, status: "BOOKABLE" })?.earnCents).toBe(18900);
    expect(workerJobView(VIEWERS.worker, { ...job, status: "REVIEW" })?.earnCents).toBeNull();
    expect(customerJobView(VIEWERS.customer, { ...job, status: "QUOTE_BOUNTY" })).toMatchObject({ priceCents: null, gstCents: null });
  });
});

describe("scoped database loading", () => {
  it("puts ownership/publication scope inside the query and has the same missing result for a guessed id", async () => {
    const findFirst = vi.fn(async () => null);
    const db = { job: { findFirst } } as unknown as PrismaClient;
    const id = exampleJob().id;
    expect(await loadJobView(db, VIEWERS.customer, id)).toBeNull();
    expect(findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { AND: [{ id }, { customerId: VIEWERS.customer.userId }] } }));
    expect(await loadJobView(db, VIEWERS.worker, id)).toBeNull();
    expect(findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { AND: [{ id }, { OR: [{ workerId: VIEWERS.worker.userId }, { status: { in: OPEN } }] }] } }));
    findFirst.mockClear();
    expect(await loadJobView(db, null, id)).toBeNull();
    expect(await loadJobView(db, VIEWERS.customer, "bad-id")).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
    expect(jobViewWhere({ userId: "", role: "ADMIN" })).toEqual({ id: { in: [] } });
  });
});

describe("Earnings projection boundaries", () => {
  it("preserves only the worker's own historical pay and minimal job reference after reassignment", () => {
    const payout = { id: "payout", workerId: VIEWERS.worker.userId, minutes: 120, rateCents: 7000, grossCents: 14000, holidayPayCents: 1120, status: "PAID" as const,
      createdAt: new Date("2026-11-01"), paidAt: new Date("2026-11-02"), job: { jobNumber: 1005, title: "Sub wiring", addressLine1: "private", customerPhone: "private", priceCents: 37200 } };
    expect(workerPayoutView(VIEWERS.worker, payout)?.job).toEqual({ jobNumber: 1005, title: "Sub wiring" });
    expect(workerPayoutView({ ...VIEWERS.worker, userId: "other" }, payout)).toBeNull();
    expect(workerPayoutView(VIEWERS.customer, payout)).toBeNull();
    const titleCanary = { ...payout, job: { ...payout.job, title: "Call 021 123 4567 or payout95@example.test" } };
    expect(JSON.stringify(workerPayoutView(VIEWERS.worker, titleCanary))).not.toMatch(/123 4567|payout95@example.test/);
    expect(workerWaitingJobView(VIEWERS.worker, exampleJob(), 18900)).toMatchObject({ totalCents: 18900 });
    expect(workerWaitingJobView(VIEWERS.worker, exampleJob({ workerId: "other" }), 18900)).toBeNull();
    expect(workerWaitingJobView(VIEWERS.worker, exampleJob({ status: "CANCELLED" }), 18900)).toBeNull();
  });
});
