// The office "All jobs" list (#170): the URL state, the database filter and order, the page of rows, the CSV, the
// page and the export route. Nothing here connects to a database: the reads get a fake. The real page, signed in,
// against a seeded local database: tests/e2e/office-jobs-signed-in.spec.ts.
import { renderToString as renderHtml } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AllJobsPage from "@/app/admin/jobs/page";
import { GET as exportJobs } from "@/app/admin/jobs/export/route";
import { AllJobs, money } from "@/components/office/AllJobs";
import {
  isFiltered,
  jobNumberFromSearch,
  OFFICE_JOBS_EXPORT_LIMIT,
  officeJobFilters,
  officeJobsSearch,
  parseOfficeJobsQuery,
} from "@/lib/office-jobs";
import { requireRole } from "@/server/auth/guard";
import { DatabaseNotConfiguredError } from "@/server/db";
import {
  csvCell,
  exportOfficeJobs,
  listOfficeJobs,
  type OfficeJobRow,
  type OfficeJobsDatabase,
  officeJobsCsv,
  officeJobsOrderBy,
  officeJobsWhere,
  shortName,
  updatedLabel,
} from "@/server/office/jobs";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/server/auth/guard", () => ({
  requireRole: vi.fn(),
  // The real wrapper checks the role first; here it just hands the request on.
  withRoleRoute: (_roles: unknown, handler: (viewer: unknown, request: Request) => Promise<Response>) => (request: Request) =>
    handler({ userId: "office", role: "ADMIN" }, request),
}));
vi.mock("@/server/office/jobs", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/office/jobs")>();
  return { ...real, listOfficeJobs: vi.fn(real.listOfficeJobs), exportOfficeJobs: vi.fn(real.exportOfficeJobs) };
});

// Vitest hashes CSS module class names ("_page_4f0108"); read them back as the names in the CSS file.
const unhash = (text: string) => text.replace(/\b_([A-Za-z-]+)_[0-9a-f]{6}\b/g, "$1");
const render = (node: Parameters<typeof renderHtml>[0]) => unhash(renderHtml(node));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/ : /g, ": ").trim();

const NOW = new Date("2026-11-01T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

/** A job as the database select returns it. */
function dbJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000001005",
    jobNumber: 1005,
    title: "Sub wiring",
    category: "ELECTRICAL",
    status: "ASSIGNED",
    priceCents: 37200,
    suburb: "Windsor",
    city: "Invercargill",
    updatedAt: minutesAgo(46),
    customer: { firstName: "Sarah", lastName: "Thompson" },
    worker: { firstName: "Jack", lastName: "Wilson" },
    ...overrides,
  };
}

function fakeDb({ jobs = [dbJob()], total = jobs.length, cities = ["Invercargill"] }: { jobs?: unknown[]; total?: number; cities?: string[] } = {}) {
  const findMany = vi.fn(async (args: { distinct?: string[] }) => (args.distinct ? cities.map((city) => ({ city })) : jobs));
  const count = vi.fn(async () => total);
  return { db: { job: { findMany, count } } as unknown as OfficeJobsDatabase, findMany, count };
}

const ROW: OfficeJobRow = {
  id: "00000000-0000-4000-8000-000000001005",
  number: "TM-1005",
  title: "Sub wiring",
  trade: "Electrical",
  status: "ASSIGNED",
  customer: "Sarah T",
  tradie: "Jack W",
  priceCents: 37200,
  suburb: "Windsor",
  city: "Invercargill",
  updated: "46m ago",
  updatedAt: minutesAgo(46).toISOString(),
};

beforeEach(() => vi.clearAllMocks());

describe("the list's state in the URL", () => {
  it("defaults to every job, newest change first, page 1", () => {
    expect(parseOfficeJobsQuery({})).toEqual({ status: "all", trade: "all", region: "all", date: "all", q: "", sort: null, page: 1 });
    expect(officeJobsSearch(parseOfficeJobsQuery({}))).toBe("");
  });

  it("reads every filter, the search, the sort and the page, and writes them back the same", () => {
    const search = "?status=price&trade=ELECTRICAL&region=Invercargill&date=30d&q=tap&sort=price.desc&page=2";
    const query = parseOfficeJobsQuery(new URLSearchParams(search));
    expect(query).toEqual({ status: "price", trade: "ELECTRICAL", region: "Invercargill", date: "30d", q: "tap", sort: { key: "price", direction: "desc" }, page: 2 });
    expect(officeJobsSearch(query)).toBe(search);
    expect(officeJobsSearch(query, { page: 1 })).toBe(search.replace("&page=2", ""));
  });

  it("what if the URL has junk in it? Every part falls back to its default, never an error", () => {
    const query = parseOfficeJobsQuery({ status: "nope", trade: "PLUMBERS", date: "1y", sort: "price.sideways", page: "-3", region: "ALL" });
    expect(query).toEqual(parseOfficeJobsQuery({}));
    expect(parseOfficeJobsQuery({ page: "2.5" }).page).toBe(1);
    expect(parseOfficeJobsQuery({ q: "x".repeat(200) }).q).toHaveLength(80);
    expect(parseOfficeJobsQuery({ status: ["done", "price"] }).status).toBe("done");
  });

  it("knows when the list is narrowed (so an empty list means nothing matches)", () => {
    expect(isFiltered(parseOfficeJobsQuery({}))).toBe(false);
    expect(isFiltered(parseOfficeJobsQuery({ q: "tap" }))).toBe(true);
    expect(isFiltered(parseOfficeJobsQuery({ date: "7d" }))).toBe(true);
    expect(isFiltered(parseOfficeJobsQuery({ sort: "price.asc", page: "3" }))).toBe(false);
  });

  it("finds a job number however it's typed", () => {
    for (const q of ["TM-1005", "tm1005", "1005", " tm-1005 "]) expect(jobNumberFromSearch(q), q).toBe(1005);
    for (const q of ["deck", "TM-", "10.5", ""]) expect(jobNumberFromSearch(q), q).toBeNull();
  });

  it("offers the status groups in office words, every trade, the cities and the date ranges", () => {
    const [status, trade, region, date] = officeJobFilters(["Gore", "Invercargill"]);
    expect(status.options.map((o) => o.label)).toEqual(["All", "Active", "To price", "Waiting on customer", "Unclaimed", "In progress", "Sign-off", "Completed", "Cancellations"]);
    expect(trade.options.map((o) => o.label)).toEqual(["All", "Electrical", "Plumbing", "Gas fitting", "Construction", "Other"]);
    expect(region.options.map((o) => o.value)).toEqual(["all", "Gore", "Invercargill"]);
    expect(date.options.map((o) => o.label)).toEqual(["Any time", "Last 7 days", "Last 30 days", "Last 90 days"]);
  });
});

describe("the database filter and order", () => {
  it("no filters: every job", () => {
    expect(officeJobsWhere(parseOfficeJobsQuery({}), NOW)).toEqual({});
  });

  it("each filter narrows the list", () => {
    const where = officeJobsWhere(parseOfficeJobsQuery({ status: "cancel", trade: "PLUMBING", region: "invercargill", date: "7d" }), NOW);
    expect(where.AND).toEqual([
      { status: { in: ["CANCEL_REVIEW", "CANCELLED"] } },
      { category: "PLUMBING" },
      { city: { equals: "invercargill", mode: "insensitive" } },
      { updatedAt: { gte: new Date("2026-10-25T12:00:00Z") } },
    ]);
  });

  it("search looks in the title, suburb and both people's names, and a job number finds that job", () => {
    const words = officeJobsWhere(parseOfficeJobsQuery({ q: "deck" }), NOW).AND as { OR: unknown[] }[];
    expect(words[0].OR).toHaveLength(4);
    expect(words[0].OR[0]).toEqual({ title: { contains: "deck", mode: "insensitive" } });
    const number = officeJobsWhere(parseOfficeJobsQuery({ q: "TM-1005" }), NOW).AND as { OR: unknown[] }[];
    expect(number[0].OR[0]).toEqual({ jobNumber: 1005 });
  });

  it("sorts newest change first by default, ties by job number, and by any column when asked", () => {
    expect(officeJobsOrderBy(null)).toEqual([{ updatedAt: "desc" }, { jobNumber: "desc" }]);
    expect(officeJobsOrderBy({ key: "price", direction: "desc" })[0]).toEqual({ priceCents: { sort: "desc", nulls: "last" } });
    expect(officeJobsOrderBy({ key: "customer", direction: "asc" })[0]).toEqual({ customer: { firstName: "asc" } });
    expect(officeJobsOrderBy({ key: "job", direction: "asc" })[0]).toEqual({ title: "asc" });
  });
});

describe("a page of jobs", () => {
  it("reads one page of 25 with the count and the cities, and shapes each row", async () => {
    const { db, findMany, count } = fakeDb({ total: 60, cities: ["Invercargill", " Gore ", "invercargill"] });
    const page = await listOfficeJobs(parseOfficeJobsQuery({ page: "2" }), { db, now: NOW });
    expect(count).toHaveBeenCalledWith({ where: {} });
    const read = findMany.mock.calls.map(([args]) => args).find((args) => !("distinct" in args)) as { skip: number; take: number };
    expect(read).toMatchObject({ skip: 25, take: 25 });
    expect(page).toMatchObject({ total: 60, page: 2, regions: ["Gore", "Invercargill"] });
    expect(page.rows[0]).toEqual(ROW);
  });

  it("what if the page is past the end? The last page shows", async () => {
    const { db, findMany } = fakeDb({ total: 30 });
    const page = await listOfficeJobs(parseOfficeJobsQuery({ page: "9" }), { db, now: NOW });
    expect(page.page).toBe(2);
    const read = findMany.mock.calls.map(([args]) => args).find((args) => !("distinct" in args)) as { skip: number };
    expect(read.skip).toBe(25);
  });

  describe("sorted by tradie, jobs nobody has claimed come last, both ways", () => {
    // A database holding `claimed` jobs with a tradie and `unclaimed` without, answering the reads the way Postgres would.
    const tradieDb = (claimed: number, unclaimed: number) => {
      const isClaimed = (where: unknown) => JSON.stringify(where ?? {}).includes('"not":null');
      const isUnclaimed = (where: unknown) => JSON.stringify(where ?? {}).includes('"workerId":null');
      const jobs = (n: number, prefix: string, worker?: null) => Array.from({ length: n }, (_, i) => dbJob({ id: `${prefix}${i}`, ...(worker === null ? { worker } : {}) }));
      const sets = { claimed: jobs(claimed, "c"), unclaimed: jobs(unclaimed, "u", null) };
      const findMany = vi.fn(async (args: { distinct?: string[]; where?: unknown; skip?: number; take?: number }) => {
        if (args.distinct) return [{ city: "Invercargill" }];
        const set = isClaimed(args.where) ? sets.claimed : isUnclaimed(args.where) ? sets.unclaimed : [...sets.claimed, ...sets.unclaimed];
        return set.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? set.length));
      });
      const count = vi.fn(async (args?: { where?: unknown }) => (isClaimed(args?.where) ? claimed : claimed + unclaimed));
      return { job: { findMany, count } } as unknown as OfficeJobsDatabase;
    };
    const ids = (rows: OfficeJobRow[]) => rows.map((row) => row.id);

    for (const direction of ["asc", "desc"]) {
      it(`${direction}: the claimed jobs, then the rest`, async () => {
        const page = await listOfficeJobs(parseOfficeJobsQuery({ sort: `tradie.${direction}` }), { db: tradieDb(2, 1), now: NOW });
        expect(ids(page.rows)).toEqual(["c0", "c1", "u0"]);
      });
    }

    it("a page that starts in the claimed jobs and ends in the rest", async () => {
      const page = await listOfficeJobs(parseOfficeJobsQuery({ sort: "tradie.desc", page: "2" }), { db: tradieDb(30, 10), now: NOW });
      expect(ids(page.rows)).toEqual([...["c25", "c26", "c27", "c28", "c29"], ...Array.from({ length: 10 }, (_, i) => `u${i}`)]);
    });

    it("a page past every claimed job skips what the earlier pages showed", async () => {
      const page = await listOfficeJobs(parseOfficeJobsQuery({ sort: "tradie.desc", page: "2" }), { db: tradieDb(10, 40), now: NOW });
      expect(ids(page.rows)).toEqual(Array.from({ length: 25 }, (_, i) => `u${i + 15}`));
    });

    it("the export keeps the same order", async () => {
      const { rows } = await exportOfficeJobs(parseOfficeJobsQuery({ sort: "tradie.desc" }), { db: tradieDb(2, 2), now: NOW });
      expect(ids(rows)).toEqual(["c0", "c1", "u0", "u1"]);
    });
  });

  it("nobody claimed it yet: no tradie; not priced yet: no price", async () => {
    const { db } = fakeDb({ jobs: [dbJob({ worker: null, priceCents: null, status: "REVIEW" })] });
    const [row] = (await listOfficeJobs(parseOfficeJobsQuery({}), { db, now: NOW })).rows;
    expect(row).toMatchObject({ tradie: null, priceCents: null, status: "REVIEW" });
  });

  it("names are first name and last initial; times say how long ago", () => {
    expect(shortName({ firstName: "Sarah", lastName: "thompson" })).toBe("Sarah T");
    expect(shortName({ firstName: "Mere", lastName: null })).toBe("Mere");
    expect(shortName({ firstName: "Mere", lastName: "  " })).toBe("Mere");
    expect(shortName(null)).toBeNull();
    expect(updatedLabel(minutesAgo(0), NOW)).toBe("Just now");
    expect(updatedLabel(minutesAgo(46), NOW)).toBe("46m ago");
    expect(updatedLabel(minutesAgo(26 * 60), NOW)).toBe("26h ago");
    expect(updatedLabel(minutesAgo(3 * 24 * 60), NOW)).toBe("3 days ago");
    expect(updatedLabel(new Date(NOW.getTime() + 60_000), NOW)).toBe("Just now"); // a clock a little ahead
  });
});

describe("Export CSV", () => {
  it("exports every matching job (no paging), and says when there were more than one file holds", async () => {
    const { db, findMany } = fakeDb({ jobs: Array.from({ length: OFFICE_JOBS_EXPORT_LIMIT + 1 }, (_, i) => dbJob({ id: `job-${i}`, jobNumber: 1001 + i })) });
    const result = await exportOfficeJobs(parseOfficeJobsQuery({ trade: "ELECTRICAL" }), { db, now: NOW });
    expect(findMany.mock.calls[0][0]).toMatchObject({ take: OFFICE_JOBS_EXPORT_LIMIT + 1, where: { AND: [{ category: "ELECTRICAL" }] } });
    expect(result.rows).toHaveLength(OFFICE_JOBS_EXPORT_LIMIT);
    expect(result.truncated).toBe(true);
  });

  it("writes a header and one line per job, the office's status words, and the price in dollars", () => {
    const csv = officeJobsCsv([ROW, { ...ROW, id: "2", number: "TM-1009", tradie: null, priceCents: null, status: "REVIEW" }]);
    expect(csv.split("\r\n")).toEqual([
      "Job number,Title,Trade,Status,Customer,Tradie,Price (NZD incl GST),Suburb,City,Updated",
      `TM-1005,Sub wiring,Electrical,In progress,Sarah T,Jack W,372.00,Windsor,Invercargill,${ROW.updatedAt}`,
      `TM-1009,Sub wiring,Electrical,To price,Sarah T,,,Windsor,Invercargill,${ROW.updatedAt}`,
      "",
    ]);
  });

  it("what if a title has commas, quotes or line breaks, or looks like a formula? It stays one safe cell", () => {
    expect(csvCell('Fix "the" tap, please')).toBe('"Fix ""the"" tap, please"');
    expect(csvCell("Two\nlines")).toBe('"Two\nlines"');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    for (const start of ["+", "-", "@", "\t"]) expect(csvCell(`${start}1`).startsWith(`'${start}`) || csvCell(`${start}1`).startsWith(`"'`)).toBe(true);
    expect(csvCell("Plain")).toBe("Plain");
  });

  it("the route sends the filtered list as a download, and says so when it was cut short", async () => {
    vi.mocked(exportOfficeJobs).mockResolvedValueOnce({ rows: [ROW], truncated: true });
    const response = await exportJobs(new Request("http://localhost/admin/jobs/export?trade=ELECTRICAL&page=4"), undefined as never);
    expect(vi.mocked(exportOfficeJobs).mock.calls[0][0]).toMatchObject({ trade: "ELECTRICAL" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="jobs-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-export-truncated")).toBe("true");
    expect(await response.text()).toContain("TM-1005,Sub wiring");
  });

  it("what if the database is down? A plain 503, never a half file", async () => {
    vi.mocked(exportOfficeJobs).mockRejectedValueOnce(new DatabaseNotConfiguredError());
    const response = await exportJobs(new Request("http://localhost/admin/jobs/export"), undefined as never);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Couldn't export the jobs. Try again.");
  });
});

describe("<AllJobs>", () => {
  const page = (rows: OfficeJobRow[], total = rows.length) => ({ rows, total, page: 1, regions: ["Invercargill"] });

  it("shows the mockup's head, search, chips and table, with the office's status words and prices", () => {
    const html = render(<AllJobs query={parseOfficeJobsQuery({})} data={page([ROW])} />);
    expect(html).toMatch(/<h1[^>]*>All jobs<\/h1>/);
    expect(text(html)).toContain("Export CSV");
    expect(html).toMatch(/<a[^>]*href="\/admin\/jobs\/export"[^>]*download/);
    for (const chip of ["Status: All", "Trade: All", "Region: All", "Date: Any time"]) expect(text(html)).toContain(chip);
    expect(text(html)).toContain("Sub wiring TM-1005 · Electrical");
    expect(text(html)).toContain("In progress");
    expect(text(html)).toContain(money(37200));
    expect(html).toMatch(/<time dateTime="[^"]+">46m ago<\/time>/);
    expect(html).toContain(`href="/admin/jobs/${ROW.id}"`);
    expect(text(html)).toContain("Showing 1 of 1");
  });

  it("Export CSV takes the filters, search and sort with it (not the page)", () => {
    const html = render(<AllJobs query={parseOfficeJobsQuery({ status: "done", q: "deck", sort: "price.asc", page: "2" })} data={page([ROW], 30)} />);
    expect(html).toContain('href="/admin/jobs/export?status=done&amp;q=deck&amp;sort=price.asc"');
  });

  it("nothing matches the filters: says so and offers Clear filters; Export CSV is greyed out", () => {
    const html = render(<AllJobs query={parseOfficeJobsQuery({ q: "nothing" })} data={page([])} />);
    expect(text(html)).toContain("No jobs match that.");
    expect(text(html)).toContain("Try fewer filters, or search for a job number.");
    expect(html).toMatch(/<a[^>]*aria-disabled="true"[^>]*>.*Export CSV/s);
    expect(text(html)).not.toContain("Showing");
  });

  it("no jobs at all: a plain empty list, no Clear filters", () => {
    const html = render(<AllJobs query={parseOfficeJobsQuery({})} data={page([])} />);
    expect(text(html)).toContain("No jobs yet.");
    expect(text(html)).not.toContain("No jobs match that.");
  });

  it("couldn't read the jobs: says so with Try again", () => {
    const html = render(<AllJobs query={parseOfficeJobsQuery({})} data={null} />);
    expect(text(html)).toContain("Can’t load jobs");
    expect(text(html)).toContain("Try again");
  });

  it("a region in the URL that no job is in still shows on its chip", () => {
    const html = render(<AllJobs query={parseOfficeJobsQuery({ region: "Gore" })} data={page([])} />);
    expect(text(html)).toContain("Region: Gore");
  });
});

describe("/admin/jobs", () => {
  it("checks the office role (coming back to the same list after log-in) and passes the page its jobs", async () => {
    vi.mocked(listOfficeJobs).mockResolvedValueOnce({ rows: [ROW], total: 1, page: 1, regions: [] });
    const html = render(await AllJobsPage({ searchParams: Promise.resolve({ status: "done", q: "tap" }) }));
    expect(requireRole).toHaveBeenCalledWith(["ADMIN"], { next: "/admin/jobs?status=done&q=tap" });
    expect(text(html)).toContain("Sub wiring");
  });

  it("what if the database is down? The page still shows, with the error in the table", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(listOfficeJobs).mockRejectedValueOnce(new Error("connection refused"));
    const html = render(await AllJobsPage({ searchParams: Promise.resolve({}) }));
    expect(text(html)).toContain("Can’t load jobs");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
