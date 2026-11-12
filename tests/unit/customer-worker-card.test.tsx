import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConfirmedPanel } from "@/components/jobs/customer/ConfirmedPanel";
import { CUSTOMER_WORKER_LICENCE_LABELS, type CustomerWorkerCard } from "@/lib/customer-worker-card";
import { loadCustomerWorkerCard } from "@/server/jobs/customer-worker-card";
import { customerJobView } from "@/server/views";
import { exampleJob, VIEWERS } from "@/app/dev/components/job-views/preview-data";
import { NOTIFICATION_COPY } from "@/server/notifications/inbox";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const now = new Date("2026-11-11T00:00:00Z");
const job = customerJobView(VIEWERS.customer, exampleJob())!;
const card: CustomerWorkerCard = { avatarUrl: null, licensed: true, rating: { average: 4.9, count: 32 }, updates: [], askedForTimes: false };
function database({ category = "ELECTRICAL", status = "VERIFIED", expires = "2027-01-01", reviews = 2 } = {}) {
  const findFirst = vi.fn().mockResolvedValue({ category, worker: { id: VIEWERS.worker.userId, role: "TRADIE", avatarPath: "private-avatar-path", workerTrades: [{ trade: "ELECTRICAL", licence: { status, checkedById: VIEWERS.office.userId, checkedAt: new Date("2026-11-01"), expiresOn: new Date(expires) } }] } });
  const aggregate = vi.fn().mockResolvedValue({ _avg: { rating: reviews ? 4.75 : null }, _count: { _all: reviews } });
  const findMany = vi.fn().mockResolvedValue([{ id: "update", type: "job.running_late", createdAt: now, payload: { lateMinutes: 30, private: "never-forwarded" } }]);
  const assignments = vi.fn().mockResolvedValue([{ id: "claim", createdAt: new Date(now.getTime() - 1000), after: { workerId: VIEWERS.worker.userId }, action: "job.claimed", actorId: VIEWERS.worker.userId }]);
  const history = vi.fn().mockResolvedValue({ createdAt: new Date(now.getTime() - 500) });
  const repeated = vi.fn().mockResolvedValue(0);
  const audits = vi.fn(input => input.where.actorId ? Promise.resolve([{ id: "event", action: "job.running_late" }]) : assignments());
  return { db: { job: { findFirst }, review: { aggregate }, notification: { findMany }, auditLog: { findMany: audits, count: repeated }, jobStatusHistory: { findFirst: history } } as unknown as Parameters<typeof loadCustomerWorkerCard>[0], findFirst, aggregate, findMany, assignments, history, repeated };
}
describe("customer worker card", () => {
  it.each(Object.keys(CUSTOMER_WORKER_LICENCE_LABELS) as (keyof typeof CUSTOMER_WORKER_LICENCE_LABELS)[])("uses the exact checked-licence line for %s", trade => {
    const html = renderToStaticMarkup(<ConfirmedPanel job={{ ...job, category: trade }} card={card} back="/dashboard" online preview />);
    const expected = CUSTOMER_WORKER_LICENCE_LABELS[trade];
    if (expected) expect(html).toContain(expected); else expect(html).not.toContain("Licensed");
    expect(html).toContain("Jack W"); expect(html).not.toContain("Wilson"); expect(html).toContain("tel:0210000002");
    expect(html).not.toMatch(/Message Jack|Receipt|calendar|Request to cancel/);
  });
  it.each([{ status: "PENDING" }, { status: "REJECTED" }, { expires: "2026-11-01" }, { category: "PLUMBING" }, { category: "OTHER" }])("never lends a pending, rejected, expired or other-trade licence: %j", async input => {
    const { db } = database(input);
    expect((await loadCustomerWorkerCard(db, VIEWERS.customer, job.id, async () => null, now))?.licensed).toBe(false);
  });
  it("hides zero-review ratings and signs avatars without exposing paths or proof details", async () => {
    const { db, aggregate, findFirst } = database({ reviews: 0 }), sign = vi.fn().mockRejectedValue(Error("storage down"));
    const result = await loadCustomerWorkerCard(db, VIEWERS.customer, job.id, sign, now);
    expect(result).toMatchObject({ avatarUrl: null, licensed: true, rating: null, updates: [{ label: NOTIFICATION_COPY["job.running_late"][0], lateMinutes: 30 }] });
    expect(sign).toHaveBeenCalledWith(VIEWERS.worker.userId, "private-avatar-path");
    expect(aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: { workerId: VIEWERS.worker.userId, hiddenAt: null } }));
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ customerId: VIEWERS.customer.userId, customer: { role: "CUSTOMER" } }) }));
    expect(JSON.stringify(result)).not.toMatch(/private-avatar-path|never-forwarded|checkedBy|workerTrades/);
    expect(renderToStaticMarkup(<ConfirmedPanel job={job} card={result} back="/" online preview />)).not.toContain("4.9");
  });
  it("shows the time-request banner only for the newest update and retains the filtered return context", () => {
    for (const type of ["job.reschedule_requested", "job.on_my_way"] as const) {
      const html = renderToStaticMarkup(<ConfirmedPanel job={job} card={{ ...card, askedForTimes: true, updates: [{ id: "latest", type, label: NOTIFICATION_COPY[type][0], createdAt: now.toISOString(), lateMinutes: null }] }} back="/dashboard?q=Sub+wiring&amp;page=2" online preview />);
      expect(html.includes("Jack asked for other times.")).toBe(type === "job.reschedule_requested");
      if (type === "job.reschedule_requested") expect(html).toContain(`/jobs/${job.id}/windows?from=`);
    }
  });
  it("renders a signed photo and rounds the public rating to one decimal", async () => {
    const { db } = database(), sign = vi.fn().mockResolvedValue("https://storage.example.test/signed-avatar");
    const loaded = await loadCustomerWorkerCard(db, VIEWERS.customer, job.id, sign, now);
    expect(loaded).toMatchObject({ avatarUrl: "https://storage.example.test/signed-avatar", rating: { average: 4.8, count: 2 } });
    const html = renderToStaticMarkup(<ConfirmedPanel job={job} card={loaded} back="/" online preview />);
    expect(html).toContain('src="https://storage.example.test/signed-avatar"'); expect(html).toContain("4.8");
  });
  it("shows the unbooked sentence and degrades an unavailable card to initials, short name and phone", () => {
    const html = renderToStaticMarkup(<ConfirmedPanel job={{ ...job, bookedDate: null, bookedTime: null }} card={card} back="/" online preview />);
    expect(html).toContain("Jack will book one of your times.");
    const unavailable = renderToStaticMarkup(<ConfirmedPanel job={job} card={null} back="/" online preview />);
    expect(unavailable).toContain("Jack W"); expect(unavailable).toContain("Call Jack");
    expect(unavailable).not.toMatch(/Licensed|4\.9|booked in|Job updates|Wilson/);
  });
  it("rejects a wrong viewer role or malformed identifier before querying", async () => {
    const { db, findFirst } = database();
    expect(await loadCustomerWorkerCard(db, VIEWERS.office, job.id)).toBeNull();
    expect(await loadCustomerWorkerCard(db, VIEWERS.customer, "not-an-id")).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
  it("hides updates when assignment proof is missing, belongs to another worker or is tied", async () => {
    for (const rows of [[], [{ createdAt: now, after: { workerId: VIEWERS.office.userId } }], [{ createdAt: now, after: { workerId: VIEWERS.worker.userId } }, { createdAt: now, after: { workerId: VIEWERS.office.userId } }]]) {
      const { db, assignments, findMany } = database(); assignments.mockResolvedValue(rows);
      expect(await loadCustomerWorkerCard(db, VIEWERS.customer, job.id, async () => null, now)).toMatchObject({ updates: [], askedForTimes: false });
      expect(findMany).not.toHaveBeenCalled();
    }
  });
  it("does not guess a claim's time when clock-timestamp history is missing", async () => {
    const { db, history, findMany } = database(); history.mockResolvedValue(null);
    expect(await loadCustomerWorkerCard(db, VIEWERS.customer, job.id, async () => null, now)).toMatchObject({ updates: [], askedForTimes: false });
    expect(findMany).not.toHaveBeenCalled();
  });
});
