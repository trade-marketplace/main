// The office Payouts page (#175) and payroll export (#166) without a database: the words and numbers it shows, the
// CSV's shape, the download route and the HTML each state renders. The database side: office-payouts-db.test.ts.
// The page in a browser at every width: tests/e2e/office-payouts.spec.ts.
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as downloadRoute } from "@/app/admin/payouts/export/route";
import { OfficePayouts } from "@/components/office/OfficePayouts";
import {
  awaitingBatch,
  batchDownloadHref,
  batchFilename,
  blockedNote,
  blockerLabel,
  csvDollars,
  csvHours,
  holidayShare,
  hoursLabel,
  parseBatchKey,
  shortName,
  type OfficePayoutsData,
  type PayoutBatch,
} from "@/lib/office/payouts";
import { getDb } from "@/server/db";
import { CSV_BOM, loadBatchCsv, payrollCsv, type PayrollCsvRow } from "@/server/office/payouts";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/server/auth/guard", () => ({
  withRole: (_roles: unknown, handler: unknown) => handler,
  withRoleRoute: (_roles: unknown, handler: (viewer: unknown, request: Request) => Promise<Response>) => (request: Request) =>
    handler({ userId: "office-1", role: "ADMIN" }, request),
}));
vi.mock("@/server/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/server/db")>()), getDb: vi.fn() }));
vi.mock("@/server/office/payouts", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/office/payouts")>();
  return { ...real, loadBatchCsv: vi.fn() };
});

const unhash = (html: string) => html.replace(/\b_([A-Za-z-]+)_[0-9a-f]{6}\b/g, "$1");
const text = (html: string) => unhash(html).replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const batch = (overrides: Partial<PayoutBatch> = {}): PayoutBatch => ({
  key: "2026-11-20T02:12:00.000Z", payday: "2026-11-20", count: 8, tradies: 4, totalCents: 301_875, status: "EXPORTED", paidAt: null, ...overrides,
});

const DATA: OfficePayoutsData = {
  payday: "2026-11-20",
  ready: { count: 1, tradies: 1, totalCents: 45_360, grossCents: 42_000, holidayPayCents: 3360, materialsCents: 0 },
  blocked: { tradies: 1, payouts: 1, names: ["Mere R"] },
  materials: { payouts: 0, jobs: [] },
  rows: [
    { id: "p1", tradie: "Jack Wilson", jobId: "j1", jobNumber: "TM-990", title: "Control panel", signedOffAt: "2026-11-02T22:00:00Z", minutes: 360, holidayPayCents: 3360, materialsCents: 0, totalCents: 45_360, blockers: [] },
    { id: "p2", tradie: "Mere Rāwiri", jobId: "j2", jobNumber: "TM-998", title: "Fence palings", signedOffAt: "2026-11-01T23:00:00Z", minutes: 330, holidayPayCents: 1672, materialsCents: 0, totalCents: 22_572, blockers: ["bank"] },
  ],
  batches: [batch(), batch({ key: "2026-10-30T02:00:00.000Z", payday: "2026-10-30", status: "PAID", paidAt: "2026-10-31T01:00:00.000Z" })],
};

describe("payout words and numbers", () => {
  it("shows hours as the mockup does, and exactly for payroll", () => {
    expect([hoursLabel(360), hoursLabel(330), hoursLabel(20), hoursLabel(65)]).toEqual(["6.0", "5.5", "0.33", "1.08"]);
    expect([csvHours(360), csvHours(330), csvHours(20), csvHours(1)]).toEqual(["6", "5.5", "0.3333", "0.0167"]);
    expect([csvDollars(41_000), csvDollars(5), csvDollars(123_456_789)]).toEqual(["410.00", "0.05", "1234567.89"]);
  });

  it("names the first thing payroll is missing", () => {
    expect(blockerLabel(["ird", "bank", "taxCode"])).toBe("No bank details");
    expect(blockerLabel(["ird", "taxCode"])).toBe("No IRD number");
    expect(blockerLabel(["taxCode"])).toBe("No tax code");
    expect(blockerLabel(["review"])).toBe("Needs payroll review");
    // Materials to check comes first: the office can act on it (#512).
    expect(blockerLabel(["bank", "materials"])).toBe("Materials to check");
  });

  it("notes who is held back, briefly", () => {
    expect(blockedNote({ tradies: 0, payouts: 0, names: [] })).toBe("Nobody held back");
    expect(blockedNote({ tradies: 1, payouts: 2, names: ["Mere R"] })).toBe("Mere R · blocks payout");
    expect(blockedNote({ tradies: 3, payouts: 3, names: ["Mere R", "Sam P", "Jo T"] })).toBe("Mere R, Sam P +1 · block payouts");
    expect(shortName({ firstName: "Mere", lastName: "Rāwiri" })).toBe("Mere R");
    expect(shortName({ firstName: "Mere", lastName: null })).toBe("Mere");
  });

  it("works out the holiday pay share and the batch to mark paid", () => {
    expect(holidayShare(DATA.ready)).toBe("8%");
    expect(holidayShare({ ...DATA.ready, grossCents: 0, holidayPayCents: 0 })).toBe("—");
    const older = batch({ key: "2026-11-13T02:00:00.000Z" });
    expect(awaitingBatch([batch(), older, batch({ key: "2026-11-06T02:00:00.000Z", status: "PAID" })])).toBe(older);
    expect(awaitingBatch([batch({ status: "PAID" })])).toBeNull();
  });

  it("accepts only batch keys the app writes", () => {
    expect(parseBatchKey("2026-11-20T02:12:00.000Z")).toBe("2026-11-20T02:12:00.000Z");
    for (const bad of ["2026-11-20T02:12:00Z", "2026-13-40T02:12:00.000Z", "yesterday", "", null, 5]) expect(parseBatchKey(bad)).toBeNull();
    expect(batchDownloadHref("2026-11-20T02:12:00.000Z")).toBe("/admin/payouts/export?batch=2026-11-20T02%3A12%3A00.000Z");
    expect(batchFilename(batch())).toBe("payroll-2026-11-20-151200.csv"); // 3:12 pm in New Zealand (NZDT)
  });
});

describe("payrollCsv", () => {
  const row = (overrides: Partial<PayrollCsvRow> = {}): PayrollCsvRow => ({
    id: "p1", minutes: 90, rateCents: 3800, grossCents: 5700, holidayPayCents: 456, materialsCents: 0,
    worker: { firstName: "Jack", lastName: "Wilson", email: "jack@example.test" }, job: { jobNumber: 990 }, ...overrides,
  });

  it("has one row per payout, grouped by tradie, with a BOM and CRLF line ends", () => {
    const csv = payrollCsv([row({ id: "p2", job: { jobNumber: 995 } }), row({ id: "p3", worker: { firstName: "Aroha", lastName: "Ngata", email: "a@example.test" } }), row()]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual([
      "Tradie,Email,Job number,Hours,Rate (NZD per hour),Gross (NZD),Holiday pay (NZD),Materials (NZD),Total (NZD),Payout id",
      "Aroha Ngata,a@example.test,TM-990,1.5,38.00,57.00,4.56,0.00,61.56,p3",
      "Jack Wilson,jack@example.test,TM-990,1.5,38.00,57.00,4.56,0.00,61.56,p1",
      "Jack Wilson,jack@example.test,TM-995,1.5,38.00,57.00,4.56,0.00,61.56,p2",
      "",
    ]);
  });

  it("adds the materials repaid to their own column and to the total (#512)", () => {
    const csv = payrollCsv([row({ materialsCents: 8_500 })]);
    expect(csv.slice(1).split("\r\n")[1]).toBe("Jack Wilson,jack@example.test,TM-990,1.5,38.00,57.00,4.56,85.00,146.56,p1");
  });

  it("can't be turned into a formula or broken by a comma in a name", () => {
    const csv = payrollCsv([row({ worker: { firstName: "=HYPERLINK(\"x\")", lastName: "Smith, Jr", email: "+x@example.test" } })]);
    expect(csv).toContain(`"'=HYPERLINK(""x"") Smith, Jr",'+x@example.test,`);
  });
});

describe("batch download route", () => {
  const load = vi.mocked(loadBatchCsv);
  beforeEach(() => { load.mockReset(); vi.mocked(getDb).mockReturnValue({} as never); });
  const get = (query: string) => downloadRoute(new Request(`http://localhost/admin/payouts/export${query}`), undefined as never);

  it("sends a batch's CSV as a download that is never cached", async () => {
    load.mockResolvedValue({ csv: `${CSV_BOM}a,b\r\n`, filename: "payroll-2026-11-20-151200.csv" });
    const response = await get("?batch=2026-11-20T02%3A12%3A00.000Z");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="payroll-2026-11-20-151200.csv"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(load).toHaveBeenCalledWith({}, { userId: "office-1", role: "ADMIN" }, "2026-11-20T02:12:00.000Z");
  });

  it("is a 404 for a missing or malformed batch, and a 503 when the database fails", async () => {
    expect((await get("")).status).toBe(404);
    expect((await get("?batch=yesterday")).status).toBe(404);
    expect(load).not.toHaveBeenCalled();
    load.mockResolvedValue(null);
    expect((await get("?batch=2026-11-20T02%3A12%3A00.000Z")).status).toBe(404);
    load.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await get("?batch=2026-11-20T02%3A12%3A00.000Z")).status).toBe(503);
  });
});

describe("OfficePayouts HTML", () => {
  const render = (props: Parameters<typeof OfficePayouts>[0]) => text(renderToString(<OfficePayouts {...props} />));

  it("shows the honest banner, the batch KPIs, queued and held-back rows, and the batches", () => {
    const html = render({ data: DATA });
    expect(html).toContain("These are payroll records. Marking paid doesn’t move money. Pay through payroll first, then mark the batch paid.");
    expect(html).toContain("Batch · Fri 20 Nov");
    expect(html).toContain("$453.60");
    expect(html).toContain("1 job · 1 tradie");
    expect(html).toContain("Holiday pay in batch");
    expect(html).toContain("Missing payroll details");
    expect(html).toContain("Mere R · blocks payout");
    expect(html).toContain("No bank details");
    expect(html).toContain("Queued");
    expect(html).toContain("Exported");
    expect(html).toContain("Paid 31 Oct");
    expect(html).toContain("Download CSV");
  });

  it("shows Nothing queued with nothing to export", () => {
    const html = render({ data: { ...DATA, rows: [], ready: { count: 0, tradies: 0, totalCents: 0, grossCents: 0, holidayPayCents: 0, materialsCents: 0 }, blocked: { tradies: 0, payouts: 0, names: [] } } });
    expect(html).toContain("Nothing queued.");
    expect(html).toContain("Nobody held back");
    expect(html).toContain("Nothing ready to export");
  });

  it("shows the error state when the page couldn't be read, and skeletons while loading", () => {
    expect(render({ data: null })).toContain("Can’t load payouts");
    expect(render({ data: null, loading: true })).not.toContain("Can’t load payouts");
  });

  it("can't mark paid with no exported batch waiting", () => {
    const html = renderToString(<OfficePayouts data={{ ...DATA, batches: [batch({ status: "PAID", paidAt: "2026-11-21T01:00:00.000Z" })] }} />);
    expect(text(html)).toContain("No exported batch waiting");
  });
});
