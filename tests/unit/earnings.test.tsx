// The tradie's Earnings page (#165, D12): the rules that turn payouts into what the page shows (src/lib/earnings.ts),
// the database read, the statement PDF, the page and the HTML it renders in each state. Nothing here connects to a
// database: the reads get a fake. The real page in a browser, at every width: tests/e2e/dev-earnings.spec.ts.
import { renderToString as renderHtml } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import EarningsPage from "@/app/(app)/earnings/page";
import { GET as statementRoute } from "@/app/(app)/earnings/statement/route";
import { Earnings } from "@/components/earnings/Earnings";
import {
  addDays,
  barHeights,
  buildEarnings,
  earningsHref,
  formatCents,
  formatHours,
  mondayOf,
  nextPayday,
  nzDay,
  parseEarningsQuery,
  type PayoutRecord,
  taxYearOf,
  weekName,
  type WaitingJob,
} from "@/lib/earnings";
import { requireRole } from "@/server/auth/guard";
import { DatabaseNotConfiguredError, getDb } from "@/server/db";
import { loadEarnings, type EarningsDatabase } from "@/server/earnings/load";
import { loadStatement, pdfSafe, statementLines, statementPdf, type Statement } from "@/server/earnings/statement";
import { calculatePayout } from "@/server/payouts/calculate";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/server/auth/guard", () => ({
  requireRole: vi.fn(),
  // The real wrapper checks the role first; here it just hands the request on.
  withRoleRoute: (_roles: unknown, handler: (viewer: unknown, request: Request) => Promise<Response>) => (request: Request) =>
    handler({ userId: "tradie-1", role: "TRADIE" }, request),
}));
vi.mock("@/server/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/server/db")>()), getDb: vi.fn() }));
vi.mock("@/server/earnings/load", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/earnings/load")>();
  return { ...real, loadEarnings: vi.fn(real.loadEarnings) };
});

// Vitest hashes CSS module class names ("_page_4f0108"); read them back as the names in the CSS file.
const unhash = (text: string) => text.replace(/\b_([A-Za-z-]+)_[0-9a-f]{6}\b/g, "$1");
const render = (node: Parameters<typeof renderHtml>[0]) => unhash(renderHtml(node)).replace(/<!-- -->/g, "");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/ : /g, ": ").trim();

// Monday 2 November 2026, 2pm in New Zealand.
const NOW = new Date("2026-11-02T01:00:00Z");

let counter = 0;
function payout(overrides: Partial<PayoutRecord> = {}): PayoutRecord {
  counter += 1;
  return {
    id: `p${counter}`,
    jobNumber: `TM-${1000 + counter}`,
    title: `Job ${counter}`,
    minutes: 120,
    rateCents: 7000,
    grossCents: 14000,
    holidayPayCents: 1120,
    status: "QUEUED",
    createdAt: "2026-10-28T20:00:00Z",
    paidAt: null,
    ...overrides,
  };
}
const paid = (paidAt: string, overrides: Partial<PayoutRecord> = {}) => payout({ status: "PAID", paidAt, createdAt: addIso(paidAt, -3), ...overrides });
function addIso(iso: string, days: number) {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}
const waitingJob = (overrides: Partial<WaitingJob> = {}): WaitingJob => ({ id: "w1", jobNumber: "TM-1005", title: "Sub wiring", totalCents: 25920, submitted: false, ...overrides });

describe("New Zealand days", () => {
  it("a moment is the day it is in New Zealand, not in UTC", () => {
    // 11am UTC on 30 October is midnight on the 31st in Auckland (daylight time).
    expect(nzDay("2026-10-30T10:59:00Z")).toBe("2026-10-30");
    expect(nzDay("2026-10-30T11:00:00Z")).toBe("2026-10-31");
    // Standard time in winter: 12:30 UTC is 00:30 the next day.
    expect(nzDay("2026-06-30T12:30:00Z")).toBe("2026-07-01");
  });

  it("weeks start on Monday and the next payroll is the coming Friday, today included", () => {
    expect(mondayOf("2026-11-02")).toBe("2026-11-02");
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
    expect(nextPayday("2026-11-02")).toBe("2026-11-06");
    expect(nextPayday("2026-11-06")).toBe("2026-11-06");
    expect(nextPayday("2026-11-07")).toBe("2026-11-13");
  });

  it("works across a month and a year", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(nextPayday("2026-12-28")).toBe("2027-01-01");
  });

  it("the tax year runs 1 April to 31 March", () => {
    expect(taxYearOf("2026-11-02")).toEqual({ start: "2026-04-01", end: "2027-03-31", name: "2026/27" });
    expect(taxYearOf("2027-03-31")).toEqual({ start: "2026-04-01", end: "2027-03-31", name: "2026/27" });
    expect(taxYearOf("2027-04-01").start).toBe("2027-04-01");
  });
});

describe("money and time", () => {
  it("shows cents as dollars, and billed time as hours and minutes", () => {
    expect(formatCents(345280)).toBe("$3,452.80");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatHours(120)).toBe("2 h");
    expect(formatHours(150)).toBe("2 h 30 min");
    expect(formatHours(45)).toBe("45 min");
  });
});

describe("what the page shows", () => {
  it("adds up what is paid this month, what is queued for the next payroll and what is waiting on sign-off", () => {
    const view = buildEarnings({
      payouts: [payout(), paid("2026-10-30T02:00:00Z"), paid("2026-10-23T02:00:00Z")],
      waiting: [waitingJob(), waitingJob({ id: "w2", totalCents: 1000 })],
      now: NOW,
    });
    // Each payout is $140.00 + $11.20 holiday pay.
    expect(view.month).toBe("November");
    expect(view.paidThisMonth).toEqual({ totalCents: 0, jobs: 0 });
    expect(view.next).toEqual({ label: "Fri 6 Nov", totalCents: 15120, jobs: 1 });
    expect(view.waiting).toMatchObject({ totalCents: 26920, jobs: 2 });
    expect(view.isEmpty).toBe(false);
  });

  it("counts a payout paid this month, and a payout paid late on the last day of last month goes to last month", () => {
    // 2 Nov 2026 at 10:30 NZ is this month; 31 Oct 2026 at 22:00 UTC is 1 Nov 11:00 NZ (this month, in New Zealand).
    const view = buildEarnings({
      payouts: [paid("2026-11-02T00:30:00Z"), paid("2026-10-31T22:00:00Z"), paid("2026-10-31T10:00:00Z")],
      waiting: [],
      now: NOW,
    });
    expect(view.paidThisMonth).toEqual({ totalCents: 3 * 0 + 2 * 15120, jobs: 2 });
  });

  it("a payout that is queued or on its way to payroll says Queued, never Paid", () => {
    // Sent to payroll on Monday 2 November for the Friday run.
    const exported = payout({ status: "EXPORTED", exportedAt: "2026-11-01T20:00:00Z" });
    const view = buildEarnings({ payouts: [payout(), exported], waiting: [], now: NOW });
    expect(view.payrolls).toHaveLength(1);
    expect(view.payrolls[0]).toMatchObject({ id: "next", status: "Queued", label: "Fri 6 Nov", late: false, totalCents: 30240 });
    expect(view.payrolls[0].lines).toHaveLength(2);
    expect(view.paidThisMonth.totalCents).toBe(0);
  });

  it("a payout sent to payroll for a payday that has passed keeps that date instead of sliding to the next Friday", () => {
    // Exported on Tuesday 27 October for Friday 30 October; payroll hasn't confirmed it by Monday 2 November.
    const stuck = payout({ id: "stuck", status: "EXPORTED", exportedAt: "2026-10-26T20:00:00Z" });
    const view = buildEarnings({ payouts: [payout(), stuck, paid("2026-10-30T02:00:00Z")], waiting: [], now: NOW });
    expect(view.payrolls.map((p) => [p.id, p.status, p.late, p.label, p.lines.length])).toEqual([
      ["next", "Queued", false, "Fri 6 Nov", 1],
      ["queued-2026-10-30", "Queued", true, "Fri 30 Oct", 1],
      ["2026-10-30", "Paid", false, "Fri 30 Oct", 1],
    ]);
    expect(view.paidThisMonth.totalCents).toBe(0);
    // It is still money on its way, so it is in the next payroll's figure.
    expect(view.next).toMatchObject({ jobs: 2, totalCents: 30240 });
  });

  it("only a stuck payout, nothing new queued: there is no 'next' row, just the one that kept its date", () => {
    const view = buildEarnings({ payouts: [payout({ status: "EXPORTED", exportedAt: "2026-10-26T20:00:00Z" })], waiting: [], now: NOW });
    expect(view.payrolls.map((p) => p.id)).toEqual(["queued-2026-10-30"]);
  });

  it("groups paid payouts into one payroll for each day they were paid, newest first, after the queued one", () => {
    const view = buildEarnings({
      payouts: [paid("2026-10-23T02:00:00Z"), payout(), paid("2026-10-30T02:00:00Z"), paid("2026-10-30T03:00:00Z")],
      waiting: [],
      now: NOW,
    });
    expect(view.payrolls.map((p) => [p.id, p.status, p.lines.length, p.totalCents])).toEqual([
      ["next", "Queued", 1, 15120],
      ["2026-10-30", "Paid", 2, 30240],
      ["2026-10-23", "Paid", 1, 15120],
    ]);
    expect(view.payrolls[1]).toMatchObject({ label: "Fri 30 Oct", short: "30 Oct" });
  });

  it("each job in a payroll shows hours, rate, pay, holiday pay and total, as the payout stored them", () => {
    const [line] = buildEarnings({
      payouts: [payout({ minutes: 150, rateCents: 7000, grossCents: 17500, holidayPayCents: 1400, createdAt: "2026-10-26T20:00:00Z" })],
      waiting: [],
      now: NOW,
    }).payrolls[0].lines;
    expect(line).toMatchObject({ hours: "2 h 30 min", rate: "$70.00/hr", gross: "$175.00", holidayPay: "$14.00", total: "$189.00", totalCents: 18900, signedOff: "Tue" });
  });

  it("charts the last eight weeks with this week last, and a payout counts in the week it was signed off", () => {
    const view = buildEarnings({
      payouts: [
        payout({ createdAt: "2026-11-01T10:00:00Z" }), // Sunday 1 Nov NZ: last week
        payout({ createdAt: "2026-11-01T11:30:00Z" }), // Monday 2 Nov 00:30 NZ: this week
        paid("2026-09-17T02:00:00Z", { createdAt: "2026-09-14T00:00:00Z" }), // Monday 14 Sep NZ: the first week
        paid("2026-09-10T02:00:00Z", { createdAt: "2026-09-10T00:00:00Z" }), // before the first week: not charted
      ],
      waiting: [],
      now: NOW,
    });
    expect(view.weeks).toHaveLength(8);
    expect(view.weeks.map((w) => w.label)).toEqual(["14 Sep", "21 Sep", "28 Sep", "5 Oct", "12 Oct", "19 Oct", "26 Oct", "This week"]);
    expect(view.weeks.map((w) => w.totalCents)).toEqual([15120, 0, 0, 0, 0, 0, 15120, 15120]);
    expect(view.weeks.map((w) => w.current)).toEqual([false, false, false, false, false, false, false, true]);
  });

  it("bar heights are a share of the tallest week, and all zero when nothing was earned", () => {
    const weeks = (cents: number[]) => cents.map((totalCents, i) => ({ start: `w${i}`, label: `w${i}`, totalCents, current: false }));
    expect(barHeights(weeks([100, 50, 0, 25]))).toEqual([100, 50, 0, 25]);
    expect(barHeights(weeks([0, 0]))).toEqual([0, 0]);
  });

  it("names each bar for screen readers and the tooltip, with its amount", () => {
    expect(weekName({ start: "2026-09-14", label: "14 Sep", totalCents: 41000, current: false })).toBe("Week of 14 Sep, $410.00");
    expect(weekName({ start: "2026-11-02", label: "This week", totalCents: 0, current: true })).toBe("This week, $0.00");
  });

  it("nothing earned and nothing waiting is the Empty state; a job waiting on sign-off is not", () => {
    expect(buildEarnings({ payouts: [], waiting: [], now: NOW }).isEmpty).toBe(true);
    expect(buildEarnings({ payouts: [], waiting: [waitingJob()], now: NOW }).isEmpty).toBe(false);
    expect(buildEarnings({ payouts: [payout()], waiting: [], now: NOW }).isEmpty).toBe(false);
  });

  it("someone paid long ago, with nothing in the stretch the page lists, is not new", () => {
    expect(buildEarnings({ payouts: [], waiting: [], now: NOW, hadEarnings: true }).isEmpty).toBe(false);
  });

  it("a payout's total is its gross plus holiday pay, the same as the payout maths", () => {
    const amounts = calculatePayout({ jobMinutes: 150, approvedExtraMinutes: [], workerRateCents: 7000, holidayPayBps: 800 });
    const [line] = buildEarnings({ payouts: [payout({ grossCents: amounts.grossCents, holidayPayCents: amounts.holidayPayCents })], waiting: [], now: NOW }).payrolls[0].lines;
    expect(line.totalCents).toBe(amounts.totalCents);
  });
});

describe("the URL", () => {
  it("reads the review state and the open payroll, and ignores anything else", () => {
    expect(parseEarningsQuery({})).toEqual({ state: "default", payroll: null });
    expect(parseEarningsQuery({ state: "empty", payroll: "next" })).toEqual({ state: "empty", payroll: "next" });
    expect(parseEarningsQuery({ payroll: "2026-10-30" }).payroll).toBe("2026-10-30");
    expect(parseEarningsQuery({ payroll: "queued-2026-10-30" }).payroll).toBe("queued-2026-10-30");
    expect(parseEarningsQuery({ state: "<script>", payroll: "../../etc" })).toEqual({ state: "default", payroll: null });
    expect(parseEarningsQuery({ state: ["error", "empty"] }).state).toBe("error");
  });

  it("writes it back, keeping a review state", () => {
    expect(earningsHref()).toBe("/earnings");
    expect(earningsHref({ payroll: "next" })).toBe("/earnings?payroll=next");
    expect(earningsHref({ state: "empty", payroll: "2026-10-30" })).toBe("/earnings?state=empty&payroll=2026-10-30");
    expect(earningsHref({ state: "default" }, "/dev/components/earnings")).toBe("/dev/components/earnings");
  });
});

// ---- the database read ----------------------------------------------------------------------------------------

function fakeDb(rows: { payouts?: unknown[]; jobs?: unknown[]; details?: unknown; everPaid?: number } = {}) {
  const payoutFindMany = vi.fn(async () => rows.payouts ?? []);
  const payoutCount = vi.fn(async () => rows.everPaid ?? 0);
  const jobFindMany = vi.fn(async () => rows.jobs ?? []);
  const detailsFind = vi.fn(async () => rows.details ?? null);
  const db = {
    payout: { findMany: payoutFindMany, count: payoutCount },
    job: { findMany: jobFindMany },
    payrollDetails: { findUnique: detailsFind },
  } as unknown as EarningsDatabase;
  return { db, payoutFindMany, payoutCount, jobFindMany, detailsFind };
}

const dbPayout = (overrides: Record<string, unknown> = {}) => ({
  id: "p1",
  minutes: 120,
  rateCents: 7000,
  grossCents: 14000,
  holidayPayCents: 1120,
  status: "QUEUED",
  createdAt: new Date("2026-10-28T20:00:00Z"),
  exportedAt: null,
  paidAt: null,
  job: { jobNumber: 1008, title: "Outdoor double plug" },
  ...overrides,
});
const dbJob = (overrides: Record<string, unknown> = {}) => ({
  id: "j1",
  jobNumber: 1006,
  title: "Kitchen reno",
  status: "ASSIGNED",
  pricing: { minutes: 300, workerRateCents: 7000, holidayPayBps: 800 },
  variations: [],
  ...overrides,
});

describe("reading one tradie's earnings", () => {
  it("only reads that tradie's rows, and never the customer's price", async () => {
    const { db, payoutFindMany, jobFindMany, detailsFind } = fakeDb();
    await loadEarnings(db, "tradie-1", NOW);
    expect(payoutFindMany.mock.calls[0]).toMatchObject([{ where: { workerId: "tradie-1" } }]);
    expect(jobFindMany.mock.calls[0]).toMatchObject([{ where: { workerId: "tradie-1", status: { in: ["ASSIGNED", "SUBMITTED"] } } }]);
    expect(detailsFind.mock.calls[0]).toMatchObject([{ where: { userId: "tradie-1" } }]);
    const selected = JSON.stringify([payoutFindMany.mock.calls[0], jobFindMany.mock.calls[0]]);
    for (const secret of ["priceCents", "marginCents", "onCostCents", "gstCents", "customerId"]) expect(selected).not.toContain(secret);
  });

  it("shapes payouts into the page's figures, with the job's TM number", async () => {
    const { db } = fakeDb({
      payouts: [dbPayout(), dbPayout({ id: "p2", status: "PAID", paidAt: new Date("2026-10-30T02:00:00Z"), job: { jobNumber: 1011, title: "Heat pump" } })],
    });
    const { view } = await loadEarnings(db, "tradie-1", NOW);
    expect(view.payrolls.map((p) => [p.status, p.lines[0].jobNumber])).toEqual([["Queued", "TM-1008"], ["Paid", "TM-1011"]]);
    expect(view.next.totalCents).toBe(15120);
  });

  it("works out what a job waiting on sign-off will pay with the payout maths, extra work included", async () => {
    const { db } = fakeDb({
      jobs: [dbJob(), dbJob({ id: "j2", jobNumber: 1007, status: "SUBMITTED", variations: [{ minutes: 90 }] })],
    });
    const { view } = await loadEarnings(db, "tradie-1", NOW);
    const plain = calculatePayout({ jobMinutes: 300, approvedExtraMinutes: [], workerRateCents: 7000, holidayPayBps: 800 });
    const extra = calculatePayout({ jobMinutes: 300, approvedExtraMinutes: [90], workerRateCents: 7000, holidayPayBps: 800 });
    expect(view.waiting.items.map((job) => [job.jobNumber, job.totalCents, job.submitted])).toEqual([
      ["TM-1006", plain.totalCents, false],
      ["TM-1007", extra.totalCents, true],
    ]);
    expect(view.waiting.totalCents).toBe(plain.totalCents + extra.totalCents);
  });

  it("what if one job's figures can't be worked out? The rest of the page still shows", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb({ jobs: [dbJob({ pricing: { minutes: 0, workerRateCents: 7000, holidayPayBps: 800 } }), dbJob({ id: "j2", jobNumber: 1007 })] });
    const { view } = await loadEarnings(db, "tradie-1", NOW);
    expect(view.waiting.items.map((job) => job.jobNumber)).toEqual(["TM-1007"]);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("someone paid long ago, with nothing in the listed stretch, isn't shown the first-earnings Empty state", async () => {
    const { db, payoutCount } = fakeDb({ everPaid: 3 });
    expect((await loadEarnings(db, "tradie-1", NOW)).view.isEmpty).toBe(false);
    expect(payoutCount.mock.calls[0]).toMatchObject([{ where: { workerId: "tradie-1" } }]);
    // A tradie who has never been paid still gets it, and one with rows to show doesn't need the extra read.
    expect((await loadEarnings(fakeDb().db, "tradie-1", NOW)).view.isEmpty).toBe(true);
    const busy = fakeDb({ payouts: [dbPayout()] });
    await loadEarnings(busy.db, "tradie-1", NOW);
    expect(busy.payoutCount).not.toHaveBeenCalled();
  });

  it("passes on when a payout was sent to payroll, so it can stay on its own payday", async () => {
    const { db } = fakeDb({ payouts: [dbPayout({ status: "EXPORTED", exportedAt: new Date("2026-10-26T20:00:00Z") })] });
    const { view } = await loadEarnings(db, "tradie-1", NOW);
    expect(view.payrolls.map((p) => [p.id, p.late])).toEqual([["queued-2026-10-30", true]]);
  });

  it("says whether payroll has the tradie's bank, IRD and tax code", async () => {
    expect((await loadEarnings(fakeDb().db, "t", NOW)).payrollDetails).toEqual({ complete: false, missing: ["ird", "bank", "taxCode"] });
    const full = { irdNumberEncrypted: "x", bankAccountEncrypted: "y", taxCode: "M" };
    expect((await loadEarnings(fakeDb({ details: full }).db, "t", NOW)).payrollDetails).toEqual({ complete: true, missing: [] });
  });
});

// ---- the statement ----------------------------------------------------------------------------------------------

function statementOf(rows: Statement["rows"], name = "Jack Wilson"): Statement {
  return { name, taxYear: taxYearOf("2026-11-02"), rows };
}
const statementRow = (overrides: Partial<Statement["rows"][number]> = {}): Statement["rows"][number] => ({
  ...payout({ status: "PAID", paidAt: "2026-10-30T02:00:00Z", title: "Heat pump circuit", jobNumber: "TM-1011" }),
  paidDay: "2026-10-30",
  ...overrides,
});

describe("the statement", () => {
  it("lists what payroll has paid in the tax year, with a total, and says it is before PAYE", () => {
    const lines = statementLines(statementOf([statementRow(), statementRow({ id: "x", title: "Rewire", jobNumber: "TM-1012" })])).map((line) => line.text);
    expect(lines[0]).toBe("Earnings statement");
    expect(lines[1]).toBe("Jack Wilson");
    expect(lines[2]).toBe("Tax year 1 April 2026 to 31 March 2027");
    expect(lines.join("\n")).toContain("before PAYE");
    expect(lines.some((line) => line.startsWith("30 Oct") && line.includes("TM-1011 Heat pump circuit") && line.includes("$151.20"))).toBe(true);
    expect(lines.at(-1)).toContain("Total, 2 jobs");
    expect(lines.at(-1)).toContain("$302.40");
  });

  it("what if nothing has been paid yet? It says so", () => {
    expect(statementLines(statementOf([])).at(-1)?.text).toBe("Nothing has been paid in this tax year yet.");
  });

  it("is a real PDF: a header, a table of byte offsets that point at each object, and an end marker", () => {
    const pdf = statementPdf(statementOf([statementRow()])).toString("latin1");
    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    const table = pdf.slice(pdf.indexOf("xref\n")).split("\n").filter((line) => /^\d{10} 00000 n $/.test(line));
    expect(table.length).toBeGreaterThanOrEqual(8);
    for (const [index, entry] of table.entries()) expect(pdf.slice(Number(entry.slice(0, 10))).startsWith(`${index + 1} 0 obj`)).toBe(true);
    expect(Number(/startxref\n(\d+)/.exec(pdf)?.[1])).toBe(pdf.indexOf("xref\n"));
  });

  it("a long statement runs onto more pages", () => {
    const rows = Array.from({ length: 120 }, (_, i) => statementRow({ id: `r${i}` }));
    expect(statementPdf(statementOf(rows)).toString("latin1")).toMatch(/\/Count ([2-9]|\d\d)/);
  });

  it("what if a title has brackets, a backslash or a macron? The PDF stays well formed", () => {
    const pdf = statementPdf(statementOf([statementRow({ title: "Fix (old) \\ Māori hall" })], "Rāwiri O'Neil")).toString("latin1");
    expect(pdf).toContain("Fix \\(old\\) \\\\ Maori hall");
    expect(pdf).toContain("Rawiri O'Neil");
    expect(pdfSafe("naïve — ok")).toBe("naive ? ok");
  });

  it("reads only the tradie's own PAID payouts inside the tax year, by New Zealand day", async () => {
    const findMany = vi.fn(async () => [
      { ...dbPayout({ status: "PAID", paidAt: new Date("2026-10-30T02:00:00Z") }) },
      // 31 March 2026 at 23:00 UTC is 1 April 2026 in Auckland: inside; 31 March 2026 at 10:00 UTC is still 31 March NZ: outside.
      { ...dbPayout({ id: "in", status: "PAID", paidAt: new Date("2026-03-31T23:00:00Z") }) },
      { ...dbPayout({ id: "out", status: "PAID", paidAt: new Date("2026-03-31T10:00:00Z") }) },
    ]);
    const statement = await loadStatement({ payout: { findMany } } as never, "tradie-1", "Jack Wilson", NOW);
    expect(findMany.mock.calls[0]).toMatchObject([{ where: { workerId: "tradie-1", status: "PAID" } }]);
    expect(statement.rows.map((row) => row.id)).toEqual(["p1", "in"]);
  });
});

describe("/earnings/statement", () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReset();
  });

  it("sends the PDF as a download that is never cached", async () => {
    const findMany = vi.fn(async () => []);
    vi.mocked(getDb).mockReturnValue({ payout: { findMany }, profile: { findUnique: vi.fn(async () => ({ firstName: "Jack", lastName: "Wilson" })) } } as never);
    const response = await (statementRoute as unknown as (request: Request) => Promise<Response>)(new Request("http://localhost/earnings/statement"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="earnings-statement-\d{4}-\d{2}-\d{2}\.pdf"$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await response.arrayBuffer()).toString("latin1").startsWith("%PDF-")).toBe(true);
  });

  it("what if the database is down? A plain 503, never a half file", async () => {
    vi.mocked(getDb).mockImplementation(() => {
      throw new DatabaseNotConfiguredError();
    });
    const response = await (statementRoute as unknown as (request: Request) => Promise<Response>)(new Request("http://localhost/earnings/statement"));
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).not.toBe("application/pdf");
  });
});

// ---- the page ----------------------------------------------------------------------------------------------------

const view = (overrides: Parameters<typeof buildEarnings>[0] extends infer T ? Partial<T> : never = {}) =>
  buildEarnings({
    payouts: [payout({ title: "Control panel", jobNumber: "TM-0990", createdAt: "2026-10-26T20:00:00Z" }), paid("2026-10-30T02:00:00Z", { title: "Heat pump", jobNumber: "TM-0981" })],
    waiting: [waitingJob()],
    now: NOW,
    ...overrides,
  });

describe("<Earnings>", () => {
  it("shows the mockup's heading, statement button, three KPIs, chart and payroll table", () => {
    const html = render(<Earnings view={view()} />);
    const words = text(html);
    expect(words).toContain("Earnings");
    expect(words).toContain("Download statement");
    expect(words).toContain("Paid in November");
    expect(words).toContain("Next payroll · Fri 6 Nov");
    expect(words).toContain("1 job signed off");
    expect(words).toContain("Waiting on sign-off");
    expect(words).toContain("0 jobs · holiday pay included");
    expect(words).toContain("Last 8 weeks");
    expect(words).toContain("This week");
    // The table's columns and a row per payroll.
    for (const column of ["Payroll", "Jobs", "Total", "Status"]) expect(words).toContain(column);
    expect(words).toContain("Fri 6 Nov");
    expect(words).toContain("Fri 30 Oct");
    expect(html).toContain('href="/earnings?payroll=next"');
    expect(html).toContain('href="/earnings?payroll=2026-10-30"');
    expect(html).toContain('href="/earnings/statement"');
  });

  it("says Queued for what payroll hasn't paid and Paid for what it has, and nothing else about money moving", () => {
    const words = text(render(<Earnings view={view()} />));
    expect(words).toMatch(/Queued/);
    expect(words).toMatch(/Paid/);
    expect(words).not.toMatch(/\b(sent to your bank|transferred|deposited|in your account)\b/i);
  });

  it("the phone's lists: the queued job, the job waiting on sign-off, and the paid payrolls", () => {
    const words = text(render(<Earnings view={view()} />));
    expect(words).toContain("TM-0990 · signed off Tue");
    expect(words).toContain("TM-1005 · in progress");
    expect(words).toContain("After sign-off");
    expect(words).toContain("Payroll 30 Oct");
  });

  it("a payroll still Queued after its payday keeps its date, in the table and in the phone's Queued list", () => {
    const stuck = payout({ id: "stuck", status: "EXPORTED", exportedAt: "2026-10-26T20:00:00Z", title: "Stuck job" });
    const html = render(<Earnings view={view({ payouts: [stuck] })} />);
    expect(html).toContain('href="/earnings?payroll=queued-2026-10-30"');
    const words = text(html);
    expect(words).toContain("Fri 30 Oct");
    expect(words).toContain("Payroll 30 Oct");
    expect(words).toMatch(/Queued Payroll 30 Oct 1 job \$151\.20 Queued/);
    expect(text(render(<Earnings view={view({ payouts: [stuck] })} payroll="queued-2026-10-30" />))).toContain("Stuck job");
  });

  it("every bar has a name with its amount, and this week's is the Hi-Vis one", () => {
    const html = render(<Earnings view={view()} />);
    expect(html.match(/<li[^>]*aria-label="(Week of|This week)[^"]*"/g)).toHaveLength(8);
    expect(html).toContain(`aria-label="This week, $0.00"`);
    expect(html).toMatch(/aria-label="This week[^"]*" class="[^"]*current/);
  });

  it("opens the payroll in the URL with each job's hours, rate and holiday pay", () => {
    const html = render(<Earnings view={view()} payroll="next" />);
    expect(html).toContain("<dialog");
    const words = text(html);
    for (const label of ["Hours", "Rate", "Holiday pay"]) expect(words).toContain(label);
    expect(words).toContain("$70.00/hr");
    expect(words).toContain("$11.20");
  });

  it("an unknown payroll in the URL just shows the list", () => {
    expect(render(<Earnings view={view()} payroll="2020-01-01" />)).not.toContain("Holiday pay</dt>");
  });

  it("asks for bank and IRD details when payroll doesn't have them and money is on its way", () => {
    const html = render(<Earnings view={view()} payrollDetails={{ complete: false, missing: ["bank"] }} />);
    expect(text(html)).toContain("Add bank account &amp; IRD number.");
    expect(html).toContain('href="/profile/payroll"');
    // The link sits in a line of text, so it must be the inline kind: the plain link is a 44px tap target that
    // stretches the line and leaves the banner's icon out of line with its words.
    expect(html).toMatch(/<a [^>]*class="[^"]*linkInline[^"]*"[^>]*href="\/profile\/payroll"|<a [^>]*href="\/profile\/payroll"[^>]*class="[^"]*linkInline/);
    expect(text(render(<Earnings view={view()} payrollDetails={{ complete: true, missing: [] }} />))).not.toContain("Add bank account");
    const nothingOnItsWay = view({ payouts: [paid("2026-10-30T02:00:00Z")], waiting: [] });
    expect(text(render(<Earnings view={nothingOnItsWay} payrollDetails={{ complete: false, missing: ["bank"] }} />))).not.toContain("Add bank account");
  });

  it("Empty: says so, offers Find work, and the statement button is greyed out", () => {
    const html = render(<Earnings view={view({ payouts: [], waiting: [] })} />);
    expect(text(html)).toContain("No earnings yet.");
    expect(html).toContain('href="/jobs"');
    expect(html).toMatch(/<a[^>]*aria-disabled="true"[^>]*>[^]*Download statement/);
    expect(text(html)).not.toContain("Last 8 weeks");
  });

  it("only a job waiting on sign-off: the page shows, with no payrolls yet", () => {
    const words = text(render(<Earnings view={view({ payouts: [], waiting: [waitingJob()] })} />));
    expect(words).toContain("No payrolls yet.");
    expect(words).toContain("Waiting on sign-off");
    expect(words).not.toContain("No earnings yet.");
  });

  it("Error: says it can't load, with Try again, and no figures", () => {
    const html = render(<Earnings view={null} />);
    expect(text(html)).toContain("Can’t load your earnings");
    expect(html).toContain("Try again");
    expect(text(html)).not.toContain("Paid in");
  });

  it("Loading: the skeleton, announced as loading", () => {
    const html = render(<Earnings view={null} loading />);
    expect(html).toContain('aria-busy="true"');
    expect(text(html)).toContain("Earnings");
    expect(text(html)).not.toContain("Can’t load");
  });

  it("long job titles are in the markup in full (the CSS wraps them)", () => {
    const long = "Replace the whole run of old cabling beside the garage and along the shared driveway";
    expect(render(<Earnings view={view({ payouts: [payout({ title: long })] })} payroll="next" />)).toContain(long);
  });
});

describe("/earnings", () => {
  beforeEach(() => {
    vi.mocked(requireRole).mockReset();
    vi.mocked(requireRole).mockResolvedValue({ userId: "tradie-1", role: "TRADIE" } as never);
    vi.mocked(getDb).mockReset();
  });

  const page = async (params: Record<string, string> = {}) => EarningsPage({ searchParams: Promise.resolve(params) });

  it("checks the tradie role, coming back to the same page after log-in", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb({ payouts: [dbPayout()] }).db as never);
    await page({ payroll: "next" });
    expect(requireRole).toHaveBeenCalledWith(["TRADIE"], { next: "/earnings?payroll=next" });
  });

  it("passes the page the signed-in tradie's earnings", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb({ payouts: [dbPayout()] }).db as never);
    const element = (await page()) as { props: { view: { next: { jobs: number } } | null } };
    expect(element.props.view?.next.jobs).toBe(1);
  });

  it("what if the database is down? The page still shows, with the error", async () => {
    vi.mocked(getDb).mockImplementation(() => {
      throw new DatabaseNotConfiguredError();
    });
    const element = (await page()) as { props: { view: unknown } };
    expect(element.props.view).toBeNull();
  });

  it("?state=empty, loading and error open those states without reading anything", async () => {
    expect(((await page({ state: "empty" })) as { props: { view: { isEmpty: boolean } } }).props.view.isEmpty).toBe(true);
    expect(((await page({ state: "error" })) as { props: { view: unknown } }).props.view).toBeNull();
    expect(((await page({ state: "loading" })) as { props: { loading: boolean } }).props.loading).toBe(true);
    expect(getDb).not.toHaveBeenCalled();
  });
});
