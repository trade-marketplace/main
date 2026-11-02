// The office's job admin view (#171): the action rules, the timeline and money read, the page and every state of the
// screen. Nothing here connects to a database: the reads get a fake. The changes, against a real Postgres:
// tests/unit/office-job-db.test.ts. The real page, signed in: tests/e2e/office-job-signed-in.spec.ts.
import { renderToString as renderHtml } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import JobAdminPage from "@/app/admin/jobs/[id]/page";
import OfficeJobPreview from "@/app/dev/components/office-job/page";
import { isPreviewState, PREVIEW_STATES, previewJob } from "@/app/dev/components/office-job/preview-data";
import { JobAdmin, type SubmitJobAction } from "@/components/office/JobAdmin";
import { JobAdminSkeleton } from "@/components/office/JobAdminSkeleton";
import {
  actionBlocked,
  forceStatusOptions,
  JOB_ACTIONS,
  money,
  type OfficeJobView,
  parseHoursToMinutes,
  parseJobAction,
  parseMoneyToCents,
  payrollState,
  timelineTitle,
  whenLabel,
} from "@/lib/office-job";
import { requireRole } from "@/server/auth/guard";
import { DatabaseNotConfiguredError } from "@/server/db";
import { getOfficeJob, historyTitle, type OfficeJobDatabase } from "@/server/office/job";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/server/auth/guard", () => ({
  requireRole: vi.fn(),
  // The real wrapper checks the role first; the shell's other actions are never called here.
  withRole: (_roles: unknown, handler: unknown) => handler,
}));
vi.mock("@/server/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/db")>()),
  getDb: vi.fn(() => ({})),
}));
vi.mock("@/server/office/job", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/office/job")>();
  return { ...real, getOfficeJob: vi.fn(real.getOfficeJob) };
});
vi.mock("@/server/office/job-actions", () => ({ jobAction: vi.fn() }));

// Vitest hashes CSS module class names ("_page_4f0108"); read them back as the names in the CSS file.
const unhash = (html: string) => html.replace(/\b_([A-Za-z-]+)_[0-9a-f]{6}\b/g, "$1");
const render = (node: Parameters<typeof renderHtml>[0]) => unhash(renderHtml(node));
const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/ : /g, ": ").replace(/\s+([.,”)])/g, "$1").replace(/([“(])\s+/g, "$1").trim();

const ID = "00000000-0000-4000-8000-000000001005";
const NOW = new Date("2026-11-02T01:00:00Z"); // 14:00 in Wellington
const submit: SubmitJobAction = async () => ({ ok: true });
const show = (job: OfficeJobView | null, extra: Partial<Parameters<typeof JobAdmin>[0]> = {}) =>
  render(<JobAdmin job={job} submit={submit} {...extra} />);

describe("parseJobAction", () => {
  const base = { jobId: ID, seenStatus: "ASSIGNED", note: "Customer asked." };

  it("accepts each action with a note", () => {
    expect(parseJobAction({ ...base, action: "cancel" })).toEqual({ ok: true, input: { action: "cancel", ...base } });
    expect(parseJobAction({ ...base, action: "reassign", workerId: ID })).toMatchObject({ ok: true, input: { action: "reassign", workerId: ID } });
    expect(parseJobAction({ ...base, action: "status", to: "BOOKABLE" })).toMatchObject({ ok: true, input: { to: "BOOKABLE" } });
    expect(parseJobAction({ ...base, action: "price", minutes: 150, materialsCents: 12000 })).toMatchObject({ ok: true, input: { minutes: 150 } });
    expect(parseJobAction({ ...base, action: "refund", paymentId: ID, mode: "partial", amountCents: 5000 })).toMatchObject({
      ok: true,
      input: { mode: "partial", amountCents: 5000 },
    });
    expect(parseJobAction({ ...base, action: "refund", paymentId: ID, mode: "full" })).toMatchObject({ ok: true, input: { amountCents: null } });
  });

  it("needs a note for every action but a message (what if the note is empty or only spaces)", () => {
    for (const action of JOB_ACTIONS) {
      expect(parseJobAction({ ...base, action, note: "   " })).toMatchObject({ ok: false, field: "note" });
      expect(parseJobAction({ ...base, action, note: undefined })).toMatchObject({ ok: false, field: "note" });
    }
    expect(parseJobAction({ ...base, action: "cancel", note: "x".repeat(501) })).toMatchObject({ ok: false, field: "note" });
  });

  it("asks for what each action needs", () => {
    expect(parseJobAction({ ...base, action: "reassign", workerId: "" })).toMatchObject({ ok: false, field: "workerId" });
    expect(parseJobAction({ ...base, action: "status", to: "NOPE" })).toMatchObject({ ok: false, field: "to" });
    expect(parseJobAction({ ...base, action: "price", minutes: null, materialsCents: 0 })).toMatchObject({ ok: false, field: "hours" });
    expect(parseJobAction({ ...base, action: "price", minutes: 60, materialsCents: null })).toMatchObject({ ok: false, field: "materials" });
    expect(parseJobAction({ ...base, action: "refund", paymentId: ID, mode: "partial", amountCents: null })).toMatchObject({ ok: false, field: "amount" });
    expect(parseJobAction({ ...base, action: "refund", paymentId: ID, mode: "partial", amountCents: 0 })).toMatchObject({ ok: false, field: "amount" });
    expect(parseJobAction({ ...base, action: "refund", paymentId: ID, mode: "some" })).toMatchObject({ ok: false, field: "mode" });
  });

  it("rejects junk: no job id, an unknown action, an unknown status, a non-object", () => {
    expect(parseJobAction({ ...base, action: "cancel", jobId: "1005" })).toMatchObject({ ok: false });
    expect(parseJobAction({ ...base, action: "delete-everything" })).toMatchObject({ ok: false, field: "action" });
    expect(parseJobAction({ ...base, action: "cancel", seenStatus: "DONE" })).toMatchObject({ ok: false, field: "seenStatus" });
    expect(parseJobAction(null)).toMatchObject({ ok: false });
    expect(parseJobAction("cancel")).toMatchObject({ ok: false });
  });

  it("parses a message and trims it", () => {
    expect(parseJobAction({ action: "message", jobId: ID, body: "  Kia ora  " })).toEqual({
      ok: true,
      input: { action: "message", jobId: ID, body: "Kia ora" },
    });
    expect(parseJobAction({ action: "message", jobId: ID, body: " " })).toMatchObject({ ok: false, field: "body" });
  });

  it("turns typed money and hours into whole cents and minutes, and refuses anything else", () => {
    expect(parseMoneyToCents("$148.50")).toBe(14850);
    expect(parseMoneyToCents("1,248")).toBe(124800);
    expect(parseMoneyToCents("0")).toBe(0);
    for (const bad of ["", "abc", "-5", "1.234", "12e3"]) expect(parseMoneyToCents(bad)).toBeNull();
    expect(parseHoursToMinutes("2.5")).toBe(150);
    expect(parseHoursToMinutes("0.75")).toBe(45);
    for (const bad of ["", "two", "-1", "1.234"]) expect(parseHoursToMinutes(bad)).toBeNull();
  });
});

describe("which actions the office can use", () => {
  const view = previewJob("default");

  it("lets an assigned, paid job be reassigned, refunded, forced and cancelled, but not re-priced once paid", () => {
    expect(actionBlocked("reassign", view)).toBeNull();
    expect(actionBlocked("refund", view)).toBeNull();
    expect(actionBlocked("status", view)).toBeNull();
    expect(actionBlocked("cancel", view)).toBeNull();
    expect(actionBlocked("price", view)).toBe("Locked once paid");
  });

  it("explains each greyed-out action", () => {
    const unpaid = previewJob("unpaid");
    expect(actionBlocked("reassign", unpaid)).toBe("No tradie yet");
    expect(actionBlocked("refund", unpaid)).toBe("Nothing to refund");
    expect(actionBlocked("price", unpaid)).toBeNull();
    expect(actionBlocked("reassign", { ...view, status: "BOOKABLE" })).toBe("Not at this stage");
    const cancelled = previewJob("cancelled");
    expect(actionBlocked("cancel", cancelled)).toBe("Already closed");
    expect(actionBlocked("refund", cancelled)).toBe("Nothing to refund");
    expect(actionBlocked("cancel", { ...view, status: "COMPLETED" })).toBe("Already closed");
  });

  it("offers every other status in the office's words, leaving out ones the job can't be in", () => {
    const all = forceStatusOptions(view);
    expect(all.map((option) => option.value)).not.toContain("ASSIGNED");
    expect(all.find((option) => option.value === "REVIEW")?.label).toBe("To price");
    // No tradie: nothing that needs one.
    const noTradie = forceStatusOptions({ status: "BOOKABLE", tradie: null, priceCents: 37200 }).map((option) => option.value);
    expect(noTradie).toEqual(expect.not.arrayContaining(["ASSIGNED", "SUBMITTED", "COMPLETED"]));
    expect(noTradie).toContain("CANCELLED");
    // No price: nothing from PRICED on, except closing it.
    const unpriced = forceStatusOptions({ status: "REVIEW", tradie: null, priceCents: null }).map((option) => option.value);
    expect(unpriced).toEqual(["QUOTE_BOUNTY", "CANCEL_REVIEW", "CANCELLED"]);
  });
});

describe("the words", () => {
  it("formats money in dollars", () => {
    expect(money(37200)).toBe("$372.00");
    expect(money(14800)).toBe("$148.00");
  });

  it("says when something happened in New Zealand time", () => {
    expect(whenLabel(new Date("2026-11-01T22:40:00Z"), NOW)).toBe("11:40 today"); // 11:40 on 2 Nov
    expect(whenLabel(new Date("2026-10-30T20:02:00Z"), NOW)).toBe("Sat 9:02");
    expect(whenLabel(new Date("2026-10-01T20:02:00Z"), NOW)).toBe("2 Oct, 9:02");
  });

  it("words timeline entries, and never drops an action it doesn't know", () => {
    const names = new Map([["w1", "Jack Wilson"]]);
    const words = (action: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null) =>
      timelineTitle({ action, before, after, names });
    expect(words("job.priced", { priceCents: null }, { priceCents: 37200 })).toBe("Priced $372.00");
    expect(words("job.claimed", null, { workerId: "w1" })).toBe("Claimed by Jack Wilson");
    expect(words("job.reassigned", null, { workerId: "w1" })).toBe("Reassigned to Jack Wilson");
    expect(words("job.status_overridden", { status: "ASSIGNED" }, { status: "BOOKABLE" })).toBe("Status forced to Unclaimed");
    expect(words("payment.refunded", { refundedCents: 0 }, { refundedCents: 37200 })).toBe("Refunded $372.00");
    expect(words("payment.partially_refunded", { refundedCents: 1000 }, { refundedCents: 6000 })).toBe("Part refund $50.00");
    expect(words("variation.priced", null, { priceCents: 14800 })).toBe("Extra work priced $148.00");
    expect(words("review.hidden", null, null)).toBe("Hidden");
    expect(words("something.brand_new_thing", null, null)).toBe("Brand new thing");
  });

  it("words the payroll pill and the status changes the audit log didn't also record", () => {
    expect(payrollState(null, "ASSIGNED")).toEqual({ label: "After sign-off", kind: "waiting" });
    expect(payrollState("QUEUED", "COMPLETED").label).toBe("Queued");
    expect(payrollState("PAID", "COMPLETED").kind).toBe("done");
    expect(payrollState(null, "CANCELLED").label).toBe("No payout");
    expect(historyTitle(null, "REVIEW")).toBe("Posted");
    expect(historyTitle("REVIEW", "PRICED")).toBe("Price sent to the customer");
  });
});

// ---------------------------------------------------------------- The read

const at = (iso: string) => new Date(iso);

function fakeDb(overrides: { job?: Record<string, unknown> | null; audit?: unknown[]; estimates?: unknown[]; messages?: unknown[]; profiles?: unknown[] } = {}) {
  const job = overrides.job === undefined ? dbJob() : overrides.job;
  const profileFind = vi.fn(async (args: { where: { id?: { in: string[] }; role?: string } }) =>
    args.where.role ? [{ id: "w2", firstName: "Aroha", lastName: "Ngata" }] : (overrides.profiles ?? PEOPLE),
  );
  const db = {
    job: { findUnique: vi.fn(async () => job) },
    auditLog: { findMany: vi.fn(async () => overrides.audit ?? []) },
    profile: { findMany: profileFind },
    estimate: { findMany: vi.fn(async () => overrides.estimates ?? []) },
    supportMessage: { findMany: vi.fn(async () => overrides.messages ?? []) },
  };
  return { db: db as unknown as OfficeJobDatabase, mocks: db };
}

const PEOPLE = [
  { id: "c1", firstName: "Sarah", lastName: "Thompson", role: "CUSTOMER" },
  { id: "w1", firstName: "Jack", lastName: "Wilson", role: "TRADIE" },
  { id: "o1", firstName: "Matt", lastName: "Larsen", role: "ADMIN" },
];

function dbJob(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    jobNumber: 1005,
    title: "Sub wiring",
    category: "ELECTRICAL",
    status: "ASSIGNED",
    suburb: "Windsor",
    priceCents: 37200,
    customerId: "c1",
    workerId: "w1",
    customer: { id: "c1", firstName: "Sarah", lastName: "Thompson" },
    worker: { id: "w1", firstName: "Jack", lastName: "Wilson" },
    pricing: { minutes: 150, materialsCents: 12000, workerGrossCents: 25920 },
    payments: [
      { id: "p1", kind: "JOB", status: "PAID", amountCents: 37200, refundedCents: 0 },
      { id: "p2", kind: "VARIATION", status: "PAID", amountCents: 14800, refundedCents: 4800 },
      { id: "p3", kind: "QUICK_LOOK", status: "FAILED", amountCents: 3000, refundedCents: 0 },
    ],
    variations: [
      { id: "v1", status: "APPROVED", priceCents: 14800 },
      { id: "v2", status: "DECLINED", priceCents: 9000 },
    ],
    payouts: [{ id: "x1", workerId: "w1", status: "QUEUED" }],
    statusHistory: [
      { id: "h3", fromStatus: "BOOKABLE", toStatus: "ASSIGNED", changedById: "w1", createdAt: at("2026-10-27T20:02:00Z") },
      { id: "h2", fromStatus: "PRICED", toStatus: "BOOKABLE", changedById: null, createdAt: at("2026-10-27T19:40:00Z") },
      { id: "h1", fromStatus: null, toStatus: "REVIEW", changedById: "c1", createdAt: at("2026-10-26T20:12:00Z") },
    ],
    ...overrides,
  };
}

describe("getOfficeJob", () => {
  it("is null for a job that doesn't exist", async () => {
    expect(await getOfficeJob(fakeDb({ job: null }).db, ID, NOW)).toBeNull();
  });

  it("reads the money: what was paid, extra work, refunds, what the tradie earns and where payroll is", async () => {
    const view = await getOfficeJob(fakeDb().db, ID, NOW);
    expect(view?.number).toBe("TM-1005");
    expect(view?.money).toEqual({
      paidCents: 37200,
      extraWorkCents: 14800,
      refundedCents: 4800,
      tradieEarnsCents: 25920,
      payroll: { label: "Queued", kind: "good" },
    });
    expect(view?.customer.name).toBe("Sarah Thompson");
    expect(view?.tradie?.name).toBe("Jack Wilson");
    expect(view?.trade).toBe("Electrical");
  });

  it("lists only payments with something left to give back", async () => {
    const view = await getOfficeJob(fakeDb().db, ID, NOW);
    expect(view?.payments).toEqual([
      { id: "p1", label: "Job", amountCents: 37200, refundableCents: 37200 },
      { id: "p2", label: "Extra work", amountCents: 14800, refundableCents: 10000 },
    ]);
  });

  it("merges the status history and the audit log, newest first, with the office's note", async () => {
    const { db } = fakeDb({
      audit: [
        { id: "a2", actorId: "o1", actorRole: "ADMIN", action: "payment.refunded", before: { refundedCents: 0 }, after: { refundedCents: 4800 }, reason: "Part of it was a duplicate.", createdAt: at("2026-11-02T00:58:00Z") },
        { id: "a1", actorId: "w1", actorRole: "TRADIE", action: "job.claimed", before: null, after: { status: "ASSIGNED", workerId: "w1" }, reason: null, createdAt: at("2026-10-27T20:02:01Z") },
      ],
      estimates: [{ updatedAt: at("2026-10-26T22:00:00Z") }, { updatedAt: at("2026-10-26T21:00:00Z") }],
    });
    const view = await getOfficeJob(db, ID, NOW);
    expect(view?.timeline.map((row) => row.title)).toEqual([
      "Refunded $48.00",
      "Claimed by Jack Wilson",
      "Paid",
      "2 estimates",
      "Posted",
    ]);
    const [refund, claim, , estimates, posted] = view?.timeline ?? [];
    expect(refund).toMatchObject({ actor: "office", actorName: "Matt", detail: "Part of it was a duplicate.", when: "13:58 today" });
    // The claim is on the timeline once: the audit entry, not the status history row beside it.
    expect(claim).toMatchObject({ actor: "tradie", actorName: "Jack" });
    expect(estimates).toMatchObject({ actor: "system", actorName: null });
    expect(posted).toMatchObject({ actor: "customer", actorName: "Sarah" });
  });

  it("keeps a status change that has no audit entry of its own (older jobs, the database's own history)", async () => {
    const view = await getOfficeJob(fakeDb().db, ID, NOW);
    expect(view?.timeline.map((row) => row.title)).toEqual(["Claimed", "Paid", "Posted"]);
  });

  it("only loads reassignment choices when there is a tradie to swap, and never the customer or the current tradie", async () => {
    const assigned = fakeDb();
    const view = await getOfficeJob(assigned.db, ID, NOW);
    expect(view?.reassignOptions).toEqual([{ id: "w2", name: "Aroha Ngata" }]);
    const where = assigned.mocks.profile.findMany.mock.calls.find(([args]) => args.where.role)?.[0].where as unknown as { id: { notIn: string[] } };
    expect(where.id.notIn).toEqual(["c1", "w1"]);

    const unclaimed = fakeDb({ job: dbJob({ status: "BOOKABLE", workerId: null, worker: null, payouts: [] }) });
    expect((await getOfficeJob(unclaimed.db, ID, NOW))?.reassignOptions).toEqual([]);
    expect(unclaimed.mocks.profile.findMany.mock.calls.some(([args]) => args.where.role)).toBe(false);
  });

  it("shows the office's messages on the right and the others on the left, oldest first", async () => {
    const { db } = fakeDb({
      messages: [
        { id: "m2", body: "Perfect, see you then.", fromOffice: true, createdAt: at("2026-11-02T00:50:00Z"), author: { firstName: "Matt", lastName: "Larsen" } },
        { id: "m1", body: "Thursday 8am suit?", fromOffice: false, createdAt: at("2026-11-02T00:40:00Z"), author: { firstName: "Sarah", lastName: "Thompson" } },
      ],
    });
    const view = await getOfficeJob(db, ID, NOW);
    expect(view?.messages.map((message) => [message.from, message.fromOffice])).toEqual([
      ["Sarah Thompson", false],
      ["Office", true],
    ]);
  });
});

// ---------------------------------------------------------------- The page

describe("the job admin page", () => {
  beforeEach(() => {
    vi.mocked(requireRole).mockReset();
    vi.mocked(getOfficeJob).mockReset();
  });

  it("checks the office role before it reads anything", async () => {
    vi.mocked(requireRole).mockRejectedValue(new Error("redirect"));
    await expect(JobAdminPage({ params: Promise.resolve({ id: ID }) })).rejects.toThrow("redirect");
    expect(getOfficeJob).not.toHaveBeenCalled();
    expect(requireRole).toHaveBeenCalledWith(["ADMIN"], { next: `/admin/jobs/${ID}` });
  });

  it("is a 404 for an address that isn't a job id, and for a job that doesn't exist", async () => {
    vi.mocked(requireRole).mockResolvedValue({} as never);
    await expect(JobAdminPage({ params: Promise.resolve({ id: "1005" }) })).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    vi.mocked(getOfficeJob).mockResolvedValue(null);
    await expect(JobAdminPage({ params: Promise.resolve({ id: ID }) })).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("shows the job", async () => {
    vi.mocked(requireRole).mockResolvedValue({} as never);
    vi.mocked(getOfficeJob).mockResolvedValue(previewJob("default"));
    const element = (await JobAdminPage({ params: Promise.resolve({ id: ID }) })) as { props: { job: OfficeJobView | null } };
    expect(element.props.job?.number).toBe("TM-1005");
  });

  it("shows 'Can't load this job' when the database can't be read", async () => {
    vi.mocked(requireRole).mockResolvedValue({} as never);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(getOfficeJob).mockRejectedValue(new Error("connection reset"));
    const element = (await JobAdminPage({ params: Promise.resolve({ id: ID }) })) as { props: { job: OfficeJobView | null } };
    expect(element.props.job).toBeNull();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
    // No database set up at all is the same screen, without noise in the log.
    vi.mocked(getOfficeJob).mockRejectedValue(new DatabaseNotConfiguredError());
    expect(((await JobAdminPage({ params: Promise.resolve({ id: ID }) })) as { props: { job: unknown } }).props.job).toBeNull();
  });
});

// ---------------------------------------------------------------- The screen

describe("JobAdmin", () => {
  it("matches the mockup: crumbs, title with the office's status word, people line, money, messages, timeline", () => {
    const html = show(previewJob("default"));
    const words = text(html);
    expect(words).toContain("All jobs");
    expect(words).toContain("TM-1005");
    expect(html).toMatch(/<h1[^>]*>Sub wiring/);
    expect(words).toContain("In progress");
    expect(words).toContain("Sarah Thompson → Jack Wilson · Electrical · Windsor");
    expect(words).toContain("Customer paid $372.00");
    expect(words).toContain("Extra work $148.00 · approved");
    expect(words).toContain("Tradie earns $259.20 + extra");
    expect(words).toContain("Payroll After sign-off");
    expect(words).toContain("Messages");
    expect(words).toContain("Kia ora Sarah, Thursday 8am suit?");
    expect(words).toContain("Message both");
    expect(words).toContain("Timeline");
    expect(html).toContain('href="/admin/jobs"');
    expect(html).toContain('aria-current="page"');
  });

  it("lists the timeline newest first with a dot coloured by who did it, and the actor in words for screen readers", () => {
    const html = show(previewJob("default"));
    const titles = [...html.matchAll(/class="eventTitle">([^<]*)</g)].map((match) => match[1]);
    expect(titles[0]).toBe("Extra work approved + paid");
    expect(titles.at(-1)).toBe("Posted");
    for (const actor of ["customer", "tradie", "office", "system"]) expect(html).toContain(`data-actor="${actor}"`);
    expect(text(html)).toContain("Office: Matt · 10:58 today");
    expect(text(html)).toContain("“Trimmed average of 3, plus 30 min for access.”");
  });

  it("shows the Actions menu with the four designed actions and Force status, and greys out what can't be used", () => {
    const open = text(show(previewJob("default"), { initialMenuOpen: true }));
    for (const label of ["Reassign tradie", "Refund (full or part)", "Edit price", "Force status", "Cancel job"]) expect(open).toContain(label);
    expect(open).toContain("Edit price (Locked once paid)");
    const unpaid = text(show(previewJob("unpaid"), { initialMenuOpen: true }));
    expect(unpaid).toContain("Reassign tradie (No tradie yet)");
    expect(unpaid).toContain("Refund (full or part) (Nothing to refund)");
    expect(unpaid).not.toContain("Edit price (");
  });

  it("keeps the menu closed until it's opened", () => {
    expect(show(previewJob("default"))).not.toContain('role="menu"');
  });

  it("shows an unpaid, untouched job: nothing paid, no tradie, no messages", () => {
    const words = text(show(previewJob("unpaid")));
    expect(words).toContain("Sarah Thompson → No tradie yet");
    expect(words).toContain("To price");
    expect(words).toContain("Customer paid Not paid yet");
    expect(words).toContain("Tradie earns Not priced yet");
    expect(words).toContain("No messages yet.");
  });

  it("shows a cancelled job's refund and a closed payroll", () => {
    const words = text(show(previewJob("cancelled")));
    expect(words).toContain("Closed");
    expect(words).toContain("Refunded $372.00");
    expect(words).toContain("Payroll No payout");
    expect(words).toContain("“Customer asked to cancel before the work started.”");
  });

  it("wraps long names, titles and notes rather than overflowing", () => {
    const html = show(previewJob("long-text"));
    expect(text(html)).toContain("Bartholomew Featherstonehaugh-Cholmondeley");
    // Every text block that can hold long words allows them to break (checked in the CSS file).
    expect(html).toContain("eventTitle");
  });

  it("shows Can't load this job with Try again when the job couldn't be read", () => {
    const words = text(show(null));
    expect(words).toContain("Can’t load this job");
    expect(words).toContain("Check your connection and try again.");
    expect(words).toContain("Try again");
    expect(words).not.toContain("Timeline");
  });

  it("shows a skeleton while loading, announced to screen readers", () => {
    const html = render(<JobAdminSkeleton />);
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("Timeline");
  });

  it("opens each dialog with its title, a required note and its own fields", () => {
    const dialog = (name: Parameters<typeof show>[1] extends infer T ? NonNullable<T> extends { initialDialog?: infer D } ? NonNullable<D> : never : never) =>
      text(show(previewJob("default"), { initialDialog: name }));

    const reassign = dialog("reassign");
    expect(reassign).toContain("Reassign tradie");
    expect(reassign).toContain("Jack Wilson will be taken off TM-1005");
    expect(reassign).toContain("Aroha Ngata");
    expect(reassign).toContain("Note");

    const refund = dialog("refund");
    expect(refund).toContain("This is a record only. No real money moves until real payments are on.");
    expect(refund).toContain("Full refund");
    expect(refund).toContain("Part refund");
    expect(refund).toContain("Record refund");
    expect(refund).toContain("Job · $372.00 left");
    expect(refund).toContain("Extra work · $148.00 left");

    const price = dialog("price");
    expect(price).toContain("Now $372.00 incl GST.");
    expect(price).toContain("Save price");

    const status = dialog("status");
    expect(status).toContain("Force status");
    expect(status).toContain("It’s logged with your note.");
    expect(status).toContain("To price");

    const cancel = dialog("cancel");
    expect(cancel).toContain("Cancel this job?");
    expect(cancel).toContain("Keep job");

    const message = dialog("message");
    expect(message).toContain("Goes to Sarah Thompson and Jack Wilson.");
    expect(message).toContain("Send message");
  });

  it("shows an error inside a dialog when saving failed", () => {
    const html = show(previewJob("default"), { initialDialog: "cancel", initialError: "Couldn’t save that. Nothing was changed. Try again." });
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain("Couldn’t save that. Nothing was changed. Try again.");
  });
});

describe("the preview page", () => {
  it("has every state, and asks for a known one", () => {
    expect(PREVIEW_STATES.length).toBeGreaterThanOrEqual(6);
    for (const state of PREVIEW_STATES) expect(isPreviewState(state)).toBe(true);
    expect(isPreviewState("nope")).toBe(false);
    expect(previewJob("no-tradie").tradie).toBeNull();
  });

  it("renders in development and is a 404 in production", async () => {
    const page = await OfficeJobPreview({ searchParams: Promise.resolve({ state: "unpaid", dialog: "price", menu: "open" }) });
    expect(render(page as never)).toContain("Edit price");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SCREENSHOT_DEV_PAGES", "");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    await expect(OfficeJobPreview({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    vi.unstubAllEnvs();
  });
});
