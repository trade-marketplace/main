import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OfficeQueues } from "@/components/office/OfficeQueues";
import { previewQueues } from "@/app/dev/components/office-queues/preview-data";
import { canFocusQueueSearch, QUEUES, parseQueueQuery, queueHref, waitingLabel } from "@/lib/office-queues";
import { queueJobWhere, queueSearchWhere, readOfficeQueues, readOfficeQueueStats } from "@/server/office/queues";
import { officeQueueJobView } from "@/server/views/office-queues";

vi.mock("next/navigation", async original => ({ ...(await original<typeof import("next/navigation")>()), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
const OFFICE = { userId: "office", role: "ADMIN" as const }, NOW = new Date("2026-11-03T00:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);
function job(id = "j1", extra: Record<string, unknown> = {}) {
  return { id, jobNumber: 1001, title: "Sub wiring", category: "ELECTRICAL", status: "REVIEW", customerId: "c1", workerId: null,
    suburb: "Windsor", city: "Invercargill", priceCents: null, asap: false, createdAt: ago(100), updatedAt: NOW,
    customer: { id: "c1", firstName: "Sarah", lastName: "Thompson" }, worker: null, statusHistory: [{ createdAt: ago(26) }],
    estimates: [{ minutes: 120, materialsCents: 1234, needsSiteVisit: false, madeBeforeEdit: false }], evidence: null, problems: [], ...extra };
}
function fake() {
  const db = {
    job: { groupBy: vi.fn(async () => [
      { status: "REVIEW", _count: { _all: 2 } }, { status: "QUOTE_BOUNTY", _count: { _all: 1 } }, { status: "PRICED", _count: { _all: 4 } },
      { status: "SUBMITTED", _count: { _all: 3 } }, { status: "CANCEL_REVIEW", _count: { _all: 1 } }, { status: "CANCELLED", _count: { _all: 9 } },
    ]), count: vi.fn(async () => 1), findMany: vi.fn(async () => [job()]) },
    jobStatusHistory: { groupBy: vi.fn(async () => [{ jobId: "j1", _max: { createdAt: ago(26) } }]) },
    variation: { aggregate: vi.fn(async () => ({ _count: { _all: 2 }, _min: { createdAt: ago(3) } })), findMany: vi.fn(async () => []) },
    completionEvidence: { aggregate: vi.fn(async () => ({ _min: { submittedAt: ago(49) as Date | null } })), findMany: vi.fn(async () => [{ submittedAt: ago(48) }]) },
    settings: { findUniqueOrThrow: vi.fn(async () => ({ autoReleaseHours: 48 })) },
    workerProfile: { count: vi.fn(async () => 3) }, supportThread: { count: vi.fn(async () => 2) },
    problemReport: { count: vi.fn(async () => 2), findMany: vi.fn(async () => []) }, auditLog: { findMany: vi.fn(async () => []) },
  };
  return db;
}

describe("office queue URL and shortcut rules", () => {
  it("round-trips tabs, search, both pagers and the default URL; malformed flags are harmless", () => {
    const query = parseQueueQuery(new URLSearchParams("tab=extra&q=Sarah+Thompson&page=2&problemPage=3"));
    expect(query).toEqual({ tab: "extra", q: "Sarah Thompson", page: 2, problemPage: 3 });
    expect(queueHref(query)).toBe("/admin?tab=extra&q=Sarah+Thompson&page=2&problemPage=3");
    expect(queueHref(parseQueueQuery({}))).toBe("/admin");
    expect(parseQueueQuery({ tab: "__proto__", q: "a".repeat(100), page: "NaN", problemPage: "-2" })).toEqual({ tab: "price", q: "a".repeat(80), page: 1, problemPage: 1 });
    expect(parseQueueQuery({ page: "1e100" }).page).toBe(1);
  });
  it("uses the slash shortcut only outside forms/menus/modals and never overrides browser shortcuts", () => {
    const event = { key: "/", altKey: false, ctrlKey: false, metaKey: false, defaultPrevented: false };
    expect(canFocusQueueSearch(event, null, false)).toBe(true);
    expect(canFocusQueueSearch(event, null, true)).toBe(false);
    expect(canFocusQueueSearch({ ...event, ctrlKey: true }, null, false)).toBe(false);
    expect(canFocusQueueSearch(event, { closest: () => ({}) } as unknown as Element, false)).toBe(false);
    expect(waitingLabel(ago(26), NOW)).toBe("26h"); expect(waitingLabel(new Date(NOW.getTime() + 1000), NOW)).toBe("new");
  });
});
describe("office queue access and predicates", () => {
  it("rejects customer/tradie reads before any database query", async () => {
    const db = fake();
    for (const role of ["CUSTOMER", "TRADIE"] as const) {
      await expect(readOfficeQueueStats(db as never, { userId: "x", role }, NOW)).rejects.toMatchObject({ digest: expect.stringContaining("404") });
      await expect(readOfficeQueues(db as never, { userId: "x", role }, parseQueueQuery({}), NOW)).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    }
    expect(db.job.groupBy).not.toHaveBeenCalled(); expect(db.settings.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it("matches email, formatted NZ phone, names and job numbers server-side without selecting private contacts", () => {
    expect(JSON.stringify(queueSearchWhere("sarah@example.test"))).toContain('"email"');
    expect(JSON.stringify(queueSearchWhere("021 123 4567"))).toContain("+64211234567");
    expect(queueSearchWhere("TM-1005").OR).toContainEqual({ jobNumber: 1005 });
    expect(JSON.stringify(queueSearchWhere("Sarah Thompson"))).toContain('"AND"');
    const visible = officeQueueJobView(OFFICE, { ...job(), customer: { ...job().customer, email: "private@example.test", phone: "+64211234567" }, estimates: [
      { minutes: 120, materialsCents: 1234, needsSiteVisit: false, madeBeforeEdit: false },
      { minutes: 600, materialsCents: 99999, needsSiteVisit: false, madeBeforeEdit: true },
    ] } as never);
    expect(visible).toMatchObject({ estimates: "1", spread: "2.0–2.0 h · $12.34–12.34" });
    expect(JSON.stringify(visible)).not.toMatch(/private@example|211234567|99999|email|phone|addressLine|margin/);
    expect(officeQueueJobView({ userId: "x", role: "TRADIE" }, job() as never)).toBeNull();
  });
  it("shares the exact unclaimed predicate for counts/rows and excludes a new BOOKABLE entry inside48 hours", async () => {
    const where = queueJobWhere("unclaimed", NOW);
    expect(where).toEqual({ status: "BOOKABLE", workerId: null, statusHistory: { some: { toStatus: "BOOKABLE", createdAt: { lte: ago(48) } }, none: { toStatus: "BOOKABLE", createdAt: { gt: ago(48) } } } });
    const db = fake(); await readOfficeQueueStats(db as never, OFFICE, NOW);
    expect(db.job.count).toHaveBeenCalledWith({ where });
    expect(db.workerProfile.count).toHaveBeenCalledWith({ where: { verifiedAt: null, user: { role: "TRADIE" } } });
  });
  it("counts tasks rather than joined jobs, leaves cancelled jobs out, and keeps distinct worker/support badges", async () => {
    const db = fake(), result = await readOfficeQueueStats(db as never, OFFICE, NOW);
    expect(Object.fromEntries(Object.entries(result.kpis).map(([key, value]) => [key, value.count]))).toEqual({ price: 3, extra: 2, cancel: 1, signoff: 3, unclaimed: 1 });
    expect(result.counts).toEqual({ queues: 10, tradies: 3, support: 2 });
    expect(result.things).toBe(12); expect(result.waitingCustomer).toBe(4);
    expect(result.kpis.price).toMatchObject({ detail: "oldest 26h", overdue: true });
    expect(result.kpis.signoff.detail).toBe("1 auto-release today");
    expect(db.variation.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "REQUESTED", job: { status: { notIn: ["CANCELLED", "COMPLETED"] } } } }));
  });
  it("uses status entry age despite a recent job update, and fails visibly rather than all-clear for missing required history", async () => {
    const db = fake(), stats = await readOfficeQueueStats(db as never, OFFICE, NOW); stats.kpis.price.count = 1;
    const result = await readOfficeQueues(db as never, OFFICE, parseQueueQuery({}), NOW, stats);
    expect(result.rows[0]).toMatchObject({ waiting: "26h", overdue: true, action: "Price it", href: "/admin/jobs/j1/price" });
    db.jobStatusHistory.groupBy.mockResolvedValue([]);
    await expect(readOfficeQueues(db as never, OFFICE, parseQueueQuery({}), NOW, stats)).rejects.toThrow("queue-read-changed");
  });
  it("uses the same sign-off overdue fallback in the KPI and row when an office override has no submitted evidence", async () => {
    const db = fake();
    db.job.groupBy.mockResolvedValue([{ status: "SUBMITTED", _count: { _all: 1 } }]);
    db.completionEvidence.aggregate.mockResolvedValue({ _min: { submittedAt: null } });
    db.jobStatusHistory.groupBy.mockResolvedValue([{ jobId: "j1", _max: { createdAt: ago(60) } }]);
    db.job.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([job("j1", { status: "SUBMITTED", evidence: null, statusHistory: [{ createdAt: ago(60) }] })]);
    const data = await readOfficeQueues(db as never, OFFICE, parseQueueQuery({ tab: "signoff" }), NOW);
    expect(data.kpis.signoff.overdue).toBe(true); expect(data.rows[0]).toMatchObject({ waiting: "60h", overdue: true, context: "—" });
  });
  it("merges evidence and override clocks before paging with a stable id tie-breaker", async () => {
    const db = fake(), stats = await readOfficeQueueStats(db as never, OFFICE, NOW);
    stats.kpis.signoff.count = 27;
    const examples = Array.from({ length: 27 }, (_, index) => job(`j${String(index).padStart(2, "0")}`, {
      status: "SUBMITTED", evidence: index % 2 ? { submittedAt: ago(62 - Math.floor(index / 2)) } : null,
      statusHistory: [{ createdAt: ago(62 - Math.floor(index / 2)) }],
    }));
    db.job.findMany.mockResolvedValueOnce(examples.filter((_, index) => index % 2)).mockResolvedValueOnce(examples.filter((_, index) => !(index % 2)));
    db.jobStatusHistory.groupBy.mockResolvedValue(examples.filter((_, index) => !(index % 2)).map(row => ({ jobId: row.id, _max: { createdAt: row.statusHistory[0].createdAt } })));
    const data = await readOfficeQueues(db as never, OFFICE, parseQueueQuery({ tab: "signoff", page: "2" }), NOW, stats);
    expect(data.rows.map(row => row.jobId)).toEqual(["j25", "j26"]);
    expect(data.rows.every(row => row.overdue)).toBe(true);
    expect(db.job.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ take: 50 }));
  });
});
describe("office queue states", () => {
  it("preserves the designated phone KPI wording separately from desktop and tab labels", () => {
    expect(QUEUES.filter(queue => "phoneCardLabel" in queue).map(queue => ({ label: queue.label, phone: "phoneCardLabel" in queue ? queue.phoneCardLabel : undefined }))).toEqual([
      { label: "Extra work", phone: "Extra work to price" }, { label: "Cancellations", phone: "Cancel requests" }, { label: "Sign-off", phone: "Waiting sign-off" },
    ]);
    const query = parseQueueQuery({}), html = renderToStaticMarkup(<OfficeQueues query={query} data={previewQueues("price", query)} />);
    expect(html).toContain("Extra work to price"); expect(html).toContain("Cancel requests"); expect(html).toContain("Waiting sign-off");
  });
  it("shows real empty/error/loading/offline states without inventing successful zero counts", () => {
    const query = parseQueueQuery({});
    expect(renderToStaticMarkup(<OfficeQueues query={query} data={previewQueues("all-clear", query)} />)).toContain("All clear");
    const error = renderToStaticMarkup(<OfficeQueues query={query} data={null} />);
    expect(error).toContain("Can’t load jobs"); expect(error).not.toContain("All clear");
    const loading = renderToStaticMarkup(<OfficeQueues query={query} data={null} loading />);
    expect(loading).toContain("aria-busy=\"true\""); expect(loading).not.toContain("All clear");
    const offline = renderToStaticMarkup(<OfficeQueues query={query} data={previewQueues("offline", query)} offline />);
    expect(offline).toContain("offline"); expect(offline).toContain("aria-disabled=\"true\"");
    const searched = parseQueueQuery({ q: "Jack" });
    expect(renderToStaticMarkup(<OfficeQueues query={searched} data={previewQueues("search", searched)} />)).not.toContain('href="#queue-problems"');
  });
});
