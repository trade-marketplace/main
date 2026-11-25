// The office Payments ledger (#176): the URL state, the database filter, the page of rows and its totals, the CSV,
// the page, the export route and the HTML each state renders. Nothing here connects to a database: the reads get a
// fake. Against a real database (and the reused refund action): office-payments-db.test.ts. In a browser at every
// width: tests/e2e/office-payments.spec.ts.
import { renderToString as renderHtml } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PaymentsPage from "@/app/admin/payments/page";
import { GET as exportPayments } from "@/app/admin/payments/export/route";
import { OfficePayments } from "@/components/office/OfficePayments";
import {
  OFFICE_PAYMENTS_EXPORT_LIMIT,
  officePaymentsSearch,
  type OfficePaymentsQuery,
  parseOfficePaymentsQuery,
  paymentDateBounds,
  paymentJobNumber,
  paymentMoney,
  paymentsFiltered,
} from "@/lib/office-payments";
import { requireRole } from "@/server/auth/guard";
import { DatabaseNotConfiguredError } from "@/server/db";
import {
  exportOfficePayments,
  listOfficePayments,
  type OfficePaymentRow,
  type OfficePaymentsDatabase,
  officePaymentsCsv,
  officePaymentsWhere,
} from "@/server/office/payments";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/server/auth/guard", () => ({
  requireRole: vi.fn(),
  withRoleRoute: (_roles: unknown, handler: (viewer: unknown, request: Request) => Promise<Response>) => (request: Request) =>
    handler({ userId: "office", role: "ADMIN" }, request),
}));
// The real refund action is the job admin's; the page only hands it to the dialog.
vi.mock("@/server/office/job-actions", () => ({ jobAction: vi.fn() }));
vi.mock("@/server/office/payments", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/office/payments")>();
  return { ...real, listOfficePayments: vi.fn(real.listOfficePayments), exportOfficePayments: vi.fn(real.exportOfficePayments) };
});

const unhash = (text: string) => text.replace(/\b_([A-Za-z-]+)_[0-9a-f]{6}\b/g, "$1");
const render = (node: Parameters<typeof renderHtml>[0]) => unhash(renderHtml(node));
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/ : /g, ": ").trim();

const OFFICE = { userId: "office", role: "ADMIN" as const };
const NOW = new Date("2026-11-20T02:00:00Z");
const query = (params: Record<string, string> = {}): OfficePaymentsQuery => parseOfficePaymentsQuery(params);

/** A payment as the database select returns it. */
function dbPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-00000000a001",
    kind: "JOB",
    status: "PARTIALLY_REFUNDED",
    amountCents: 52_000,
    refundedCents: 2500,
    paidAt: new Date("2026-11-04T01:00:00Z"),
    createdAt: new Date("2026-11-04T00:55:00Z"),
    providerPaymentId: "pi_3Example",
    job: { id: "00000000-0000-4000-8000-000000001005", jobNumber: 1005, title: "Sub wiring", status: "ASSIGNED", customer: { firstName: "Sarah", lastName: "Thompson", email: "sarah@example.test" } },
    ...overrides,
  };
}

function fakeDb({ payments = [dbPayment()], total = payments.length, sums = { amountCents: 52_000, refundedCents: 2500 } }: { payments?: unknown[]; total?: number; sums?: { amountCents: number | null; refundedCents: number | null } } = {}) {
  const findMany = vi.fn(async () => payments);
  const count = vi.fn(async () => total);
  const aggregate = vi.fn(async () => ({ _sum: sums }));
  return { db: { payment: { findMany, count, aggregate } } as unknown as OfficePaymentsDatabase, findMany, count, aggregate };
}

const ROW: OfficePaymentRow = {
  id: "00000000-0000-4000-8000-00000000a001",
  date: "2026-11-04T01:00:00.000Z",
  job: { id: "00000000-0000-4000-8000-000000001005", number: "TM-1005", title: "Sub wiring", status: "ASSIGNED" },
  customer: "Sarah Thompson",
  email: "sarah@example.test",
  kind: "JOB",
  amountCents: 52_000,
  refundedCents: 2500,
  refundableCents: 49_500,
  status: "PARTIALLY_REFUNDED",
  stripeId: "pi_3Example",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(OFFICE as never);
});

describe("the list's state in the URL", () => {
  it("reads filters, search and page, and falls back to the defaults for anything unknown", () => {
    expect(query({ status: "refunded", kind: "QUICK_LOOK", date: "last-month", q: "  tm-1005 ", page: "3" })).toEqual({ status: "refunded", kind: "QUICK_LOOK", date: "last-month", q: "tm-1005", page: 3 });
    expect(query({ status: "PAID", kind: "job", date: "1y", page: "-2" })).toEqual({ status: "all", kind: "all", date: "all", q: "", page: 1 });
    expect(query({ page: "1.5" }).page).toBe(1);
    expect(query({ q: "x".repeat(200) }).q).toHaveLength(80);
    expect(parseOfficePaymentsQuery(new URLSearchParams("status=part&status=paid")).status).toBe("part");
  });

  it("writes only what differs from the defaults, so a clean list is a clean URL", () => {
    expect(officePaymentsSearch(query())).toBe("");
    expect(officePaymentsSearch(query({ status: "paid", kind: "JOB", date: "30d", q: "sarah", page: "2" }))).toBe("?status=paid&kind=JOB&date=30d&q=sarah&page=2");
    expect(officePaymentsSearch(query({ q: "sarah", page: "2" }), { page: 1 })).toBe("?q=sarah");
    expect(paymentsFiltered(query())).toBe(false);
    expect(paymentsFiltered(query({ date: "7d" }))).toBe(true);
    expect(paymentsFiltered(query({ q: "x" }))).toBe(true);
  });

  it("reads a job number however it is typed", () => {
    for (const value of ["TM-1005", "tm1005", "1005", " 1005 "]) expect(paymentJobNumber(value)).toBe(1005);
    expect(paymentJobNumber("sarah")).toBeNull();
    expect(paymentJobNumber("TM-")).toBeNull();
  });

  it("date ranges: rolling days, and New Zealand months whatever the daylight saving", () => {
    expect(paymentDateBounds("all", NOW)).toBeNull();
    expect(paymentDateBounds("7d", NOW)).toEqual({ from: new Date("2026-11-13T02:00:00Z"), before: null });
    // 1 Nov 2026 00:00 in New Zealand (NZDT, +13) is 31 Oct 11:00 UTC; 1 Oct (NZDT since 27 Sep) is 30 Sep 11:00 UTC.
    expect(paymentDateBounds("month", NOW)).toEqual({ from: new Date("2026-10-31T11:00:00Z"), before: null });
    expect(paymentDateBounds("last-month", NOW)).toEqual({ from: new Date("2026-09-30T11:00:00Z"), before: new Date("2026-10-31T11:00:00Z") });
    // Winter (NZST, +12): 1 Jul 2026 is 30 Jun 12:00 UTC.
    expect(paymentDateBounds("month", new Date("2026-07-15T00:00:00Z"))?.from).toEqual(new Date("2026-06-30T12:00:00Z"));
    // A month that started in daylight saving but is read in standard time (April, after 5 Apr 2026): 1 Apr was NZDT.
    expect(paymentDateBounds("last-month", new Date("2026-05-10T00:00:00Z"))).toEqual({ from: new Date("2026-03-31T11:00:00Z"), before: new Date("2026-04-30T12:00:00Z") });
    // Early on the 1st in New Zealand is still the previous month in UTC; January's last month is last year's December.
    expect(paymentDateBounds("month", new Date("2026-01-01T02:00:00Z"))?.from).toEqual(new Date("2025-12-31T11:00:00Z"));
    expect(paymentDateBounds("last-month", new Date("2026-01-10T00:00:00Z"))?.from).toEqual(new Date("2025-11-30T11:00:00Z"));
  });
});

describe("the database filter", () => {
  it("no filters: every payment", () => {
    expect(officePaymentsWhere(query(), NOW)).toEqual({});
  });

  it("status, kind and date: the date the ledger shows (paid, or started while unpaid)", () => {
    const where = officePaymentsWhere(query({ status: "part", kind: "VARIATION", date: "last-month" }), NOW);
    const range = { gte: new Date("2026-09-30T11:00:00Z"), lt: new Date("2026-10-31T11:00:00Z") };
    expect(where).toEqual({ AND: [{ status: { in: ["PARTIALLY_REFUNDED"] } }, { kind: "VARIATION" }, { OR: [{ paidAt: range }, { paidAt: null, createdAt: range }] }] });
  });

  it("search: a job number, or every word in the customer's name or email", () => {
    const where = officePaymentsWhere(query({ q: "1005" }), NOW) as { AND: [{ OR: unknown[] }] };
    expect(where.AND[0].OR[0]).toEqual({ job: { jobNumber: 1005 } });
    const named = officePaymentsWhere(query({ q: "Sarah Thompson" }), NOW) as { AND: [{ OR: { job: { customer: { AND: unknown[] } } }[] }] };
    expect(named.AND[0].OR).toHaveLength(1);
    expect(named.AND[0].OR[0].job.customer.AND).toEqual(
      ["Sarah", "Thompson"].map((word) => ({
        OR: [{ firstName: { contains: word, mode: "insensitive" } }, { lastName: { contains: word, mode: "insensitive" } }, { email: { contains: word, mode: "insensitive" } }],
      })),
    );
    const email = officePaymentsWhere(query({ q: "sarah@example.test" }), NOW) as { AND: [{ OR: { job: { customer: { AND: { OR: unknown[] }[] } } }[] }] };
    expect(email.AND[0].OR[0].job.customer.AND[0].OR[2]).toEqual({ email: { contains: "sarah@example.test", mode: "insensitive" } });
  });
});

describe("listOfficePayments", () => {
  it("refuses a non-office reader before reading anything", async () => {
    const { db, findMany, count, aggregate } = fakeDb();
    for (const viewer of [{ userId: "c", role: "CUSTOMER" as const }, { userId: "t", role: "TRADIE" as const }, { userId: "", role: "ADMIN" as const }]) {
      await expect(listOfficePayments(viewer, query(), { db })).rejects.toMatchObject({ digest: expect.stringContaining("404") });
      await expect(exportOfficePayments(viewer, query(), { db })).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    }
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
    expect(aggregate).not.toHaveBeenCalled();
  });

  it("a page of rows, newest first, 25 a page, with the totals of the whole filtered list", async () => {
    const { db, findMany, aggregate } = fakeDb({ total: 60, sums: { amountCents: 100_000, refundedCents: 12_500 } });
    const page = await listOfficePayments(OFFICE, query({ page: "2", kind: "JOB" }), { db, now: NOW });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: 25, take: 25, where: { AND: [{ kind: "JOB" }] } }));
    // Totals only count payments that took money.
    expect(aggregate).toHaveBeenCalledWith({ where: { AND: [{ AND: [{ kind: "JOB" }] }, { status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } }] }, _sum: { amountCents: true, refundedCents: true } });
    expect(page).toMatchObject({ total: 60, page: 2, totals: { paidCents: 100_000, refundedCents: 12_500, netCents: 87_500 } });
    expect(page.rows).toEqual([ROW]);
  });

  it("what if the page is past the end? The last page; and nothing at all totals zero", async () => {
    const { db, findMany } = fakeDb({ payments: [], total: 0, sums: { amountCents: null, refundedCents: null } });
    const page = await listOfficePayments(OFFICE, query({ page: "9" }), { db, now: NOW });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0 }));
    expect(page).toEqual({ rows: [], total: 0, page: 1, totals: { paidCents: 0, refundedCents: 0, netCents: 0 } });
  });

  it("what can still be refunded: only Paid and Part refunded; an unpaid payment shows when it started", async () => {
    const { db } = fakeDb({
      payments: [
        dbPayment({ status: "PAID", refundedCents: 0 }),
        dbPayment({ status: "REFUNDED", refundedCents: 52_000 }),
        dbPayment({ status: "PENDING", refundedCents: 0, paidAt: null, providerPaymentId: null }),
        dbPayment({ status: "FAILED", refundedCents: 0, paidAt: null }),
      ],
    });
    const { rows } = await listOfficePayments(OFFICE, query(), { db, now: NOW });
    expect(rows.map((row) => row.refundableCents)).toEqual([52_000, 0, 0, 0]);
    expect(rows[2]).toMatchObject({ date: "2026-11-04T00:55:00.000Z", stripeId: null });
    expect(rows[0].customer).toBe("Sarah Thompson");
    const single = fakeDb({ payments: [dbPayment({ job: { ...dbPayment().job, customer: { firstName: "Mere", lastName: null, email: "m@example.test" } } })] });
    expect((await listOfficePayments(OFFICE, query(), { db: single.db, now: NOW })).rows[0].customer).toBe("Mere");
  });

  it("export: every matching payment up to the limit, and says when it was cut short", async () => {
    const many = Array.from({ length: 3 }, () => dbPayment());
    const { db, findMany } = fakeDb({ payments: many });
    const result = await exportOfficePayments(OFFICE, query({ status: "paid" }), { db, now: NOW });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: OFFICE_PAYMENTS_EXPORT_LIMIT + 1, where: { AND: [{ status: { in: ["PAID"] } }] } }));
    expect(result).toMatchObject({ truncated: false });
    expect(result.rows).toHaveLength(3);
  });
});

describe("Export CSV", () => {
  it("one row per payment, money in dollars, the ledger's words, office-only ids", () => {
    const csv = officePaymentsCsv([ROW, { ...ROW, id: "p2", stripeId: null, status: "PENDING", refundedCents: 0, kind: "QUICK_LOOK", amountCents: 3000 }]);
    expect(csv.split("\r\n")).toEqual([
      "Date,Job number,Job title,Customer,Email,Kind,Amount (NZD incl GST),Refunded (NZD),Status,Stripe payment id,Payment id",
      `2026-11-04T01:00:00.000Z,TM-1005,Sub wiring,Sarah Thompson,sarah@example.test,Job,520.00,25.00,Part refunded,pi_3Example,${ROW.id}`,
      "2026-11-04T01:00:00.000Z,TM-1005,Sub wiring,Sarah Thompson,sarah@example.test,Quick look,30.00,0.00,Pending,,p2",
      "",
    ]);
  });

  it("what if a title or name looks like a formula, or has commas and quotes? One safe cell", () => {
    const csv = officePaymentsCsv([{ ...ROW, customer: "=cmd()", job: { ...ROW.job, title: 'Tap, "outside"' } }]);
    expect(csv).toContain(`TM-1005,"Tap, ""outside""",'=cmd(),`);
  });

  it("the route sends the filtered list as a download, and says so when it was cut short", async () => {
    vi.mocked(exportOfficePayments).mockResolvedValueOnce({ rows: [ROW], truncated: true });
    const response = await exportPayments(new Request("http://localhost/admin/payments/export?status=refunded&q=sarah&page=3"), undefined as never);
    expect(vi.mocked(exportOfficePayments).mock.calls[0][1]).toEqual({ status: "refunded", kind: "all", date: "all", q: "sarah", page: 3 });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="payments-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-export-truncated")).toBe("true");
    expect(await response.text()).toContain("TM-1005,Sub wiring");
  });

  it("what if the database is down? A plain 503, never a half file", async () => {
    vi.mocked(exportOfficePayments).mockRejectedValueOnce(new DatabaseNotConfiguredError());
    const response = await exportPayments(new Request("http://localhost/admin/payments/export"), undefined as never);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Couldn't export the payments. Try again.");
  });
});

describe("<OfficePayments>", () => {
  const page = (rows: OfficePaymentRow[], total = rows.length) => ({ rows, total, page: 1, totals: { paidCents: 52_000, refundedCents: 2500, netCents: 49_500 } });

  it("the head, search, chips, totals and a row with every column, Stripe id included", () => {
    const html = render(<OfficePayments query={query()} data={page([ROW])} />);
    expect(html).toMatch(/<h1[^>]*>Payments<\/h1>/);
    expect(html).toMatch(/<a[^>]*href="\/admin\/payments\/export"[^>]*download/);
    for (const chip of ["Status: All", "Kind: All", "Date: Any time"]) expect(text(html)).toContain(chip);
    expect(text(html)).toContain(`Paid ${paymentMoney(52_000)}`);
    expect(text(html)).toContain(`Refunded ${paymentMoney(2500)}`);
    expect(text(html)).toContain(`Net ${paymentMoney(49_500)}`);
    expect(html).toMatch(/<time dateTime="2026-11-04T01:00:00.000Z">4 Nov 2026<\/time>/);
    expect(text(html)).toContain("Sub wiring TM-1005");
    expect(html).toContain(`href="/admin/jobs/${ROW.job.id}"`);
    for (const value of ["Sarah Thompson", "sarah@example.test", "Part refunded", "pi_3Example", "$520.00", "$25.00"]) expect(text(html)).toContain(value);
    expect(html).toMatch(/<button[^>]*aria-label="Refund TM-1005, Job"/);
    expect(text(html)).toContain("Showing 1 of 1");
  });

  it("Refund is greyed out with a reason when nothing is left to give back", () => {
    const html = render(<OfficePayments query={query()} data={page([{ ...ROW, status: "REFUNDED", refundedCents: 52_000, refundableCents: 0 }])} />);
    expect(html).toMatch(/<button[^>]*aria-disabled="true"[^>]*aria-label="Refund TM-1005, Job"|aria-label="Refund TM-1005, Job"[^>]*aria-disabled="true"/);
    expect(text(html)).toContain("Nothing to refund");
  });

  it("Export CSV takes the filters and search with it (not the page)", () => {
    const html = render(<OfficePayments query={query({ status: "refunded", q: "sarah", page: "2" })} data={page([ROW], 30)} />);
    expect(html).toContain('href="/admin/payments/export?status=refunded&amp;q=sarah"');
  });

  it("nothing matches: says so with Clear filters; Export CSV is greyed out; totals are zero", () => {
    const html = render(<OfficePayments query={query({ q: "nobody" })} data={{ rows: [], total: 0, page: 1, totals: { paidCents: 0, refundedCents: 0, netCents: 0 } }} />);
    expect(text(html)).toContain("No payments match that.");
    expect(text(html)).toContain("Clear filters");
    expect(html).toMatch(/<a[^>]*aria-disabled="true"[^>]*>.*Export CSV/s);
    expect(text(html)).not.toContain("Showing");
  });

  it("no payments at all: a plain empty list", () => {
    const html = render(<OfficePayments query={query()} data={{ rows: [], total: 0, page: 1, totals: { paidCents: 0, refundedCents: 0, netCents: 0 } }} />);
    expect(text(html)).toContain("No payments yet.");
    expect(text(html)).not.toContain("No payments match that.");
  });

  it("couldn't read them: says so with Try again, and no totals", () => {
    const html = render(<OfficePayments query={query()} data={null} />);
    expect(text(html)).toContain("Can’t load payments");
    expect(text(html)).toContain("Try again");
    expect(text(html)).not.toContain("Net");
  });

  it("loading: the table is busy and the totals are skeletons", () => {
    const html = render(<OfficePayments query={query()} data={null} loading />);
    expect(html).toMatch(/<table[^>]*aria-busy="true"/);
    expect(text(html)).not.toContain("Can’t load payments");
  });

  it("offline: the banner shows, and Refund and Export CSV wait", () => {
    const html = render(<OfficePayments query={query()} data={page([ROW])} offline />);
    expect(text(html)).toContain("You’re offline");
    expect(html).toMatch(/<a[^>]*aria-disabled="true"[^>]*>.*Export CSV/s);
    expect(html).toMatch(/aria-disabled="true"[^>]*aria-label="Refund TM-1005, Job"|aria-label="Refund TM-1005, Job"[^>]*aria-disabled="true"/);
  });

  it("the refund dialog is the job admin's: test-mode banner, full or part, a note, Record refund", () => {
    const html = render(<OfficePayments query={query()} data={page([ROW])} initialRefundId={ROW.id} />);
    for (const words of ["Test mode.", "No real money moves until real payments are on.", "Full refund", "Part refund", "Note", "Record refund"]) expect(text(html)).toContain(words);
    expect(text(html)).toContain(paymentMoney(49_500));
  });
});

describe("/admin/payments", () => {
  it("checks the office role (coming back to the same list after log-in) and passes the page its payments", async () => {
    vi.mocked(listOfficePayments).mockResolvedValueOnce({ rows: [ROW], total: 1, page: 1, totals: { paidCents: 1, refundedCents: 0, netCents: 1 } });
    const html = render(await PaymentsPage({ searchParams: Promise.resolve({ status: "paid", q: "tap" }) }));
    expect(requireRole).toHaveBeenCalledWith(["ADMIN"], { next: "/admin/payments?status=paid&q=tap" });
    expect(text(html)).toContain("Sub wiring");
  });

  it("what if the database is down? The page still shows, with the error in the table", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(listOfficePayments).mockRejectedValueOnce(new Error("connection refused"));
    const html = render(await PaymentsPage({ searchParams: Promise.resolve({}) }));
    expect(text(html)).toContain("Can’t load payments");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
