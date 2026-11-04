import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CustomerJobs } from "@/components/jobs/CustomerJobs";
import { CustomerJobSummary } from "@/components/jobs/PostedJob";
import { exampleJob, VIEWERS } from "@/app/dev/components/job-views/preview-data";
import { customerJobListView, customerJobView } from "@/server/views/jobs";
import { customerJobAction, customerJobUpdated, customerJobsHref, customerJobsReturn, customerListJobHref, parseCustomerJobsQuery } from "@/lib/customer-jobs";
import { boardJobHref, boardReturn } from "@/lib/job-board";

const navigation = vi.hoisted(() => ({ from: null as string | null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams(navigation.from ? { from: navigation.from } : {}) }));
describe("customer jobs query and states", () => {
  it("bounds search and page values and strips unknown query fields", () => {
    expect(parseCustomerJobsQuery({ tab: "foreign", q: `  ${"x".repeat(150)}  `, page: "999999999" })).toEqual({ tab: "active", q: "x".repeat(100), page: 1 });
    expect(parseCustomerJobsQuery(new URLSearchParams("tab=done&q=TM-1005&page=2"))).toEqual({ tab: "done", q: "TM-1005", page: 2 });
    expect(customerJobsHref(parseCustomerJobsQuery({ tab: "active", page: "0", q: " " }))).toBe("/dashboard");
  });
  it("uses New Zealand calendar days for Today and Yesterday across midnight", () => {
    expect(customerJobUpdated("2026-11-04T09:30:00Z", new Date("2026-11-04T11:30:00Z"))).toBe("Yesterday");
    expect(customerJobUpdated("2026-11-04T01:00:00Z", new Date("2026-11-04T09:30:00Z"))).toBe("Today");
  });
  it("preserves canonical tab, search and page in the job's return path", () => {
    const href = customerListJobHref("13100000-0000-4000-8000-000000000001", { tab: "cancelled", q: "tap & sink", page: 2 });
    expect(new URL(href, "https://list.invalid").searchParams.get("from")).toBe("/dashboard?tab=cancelled&q=tap+%26+sink&page=2");
  });
  it("rejects external and malformed returns and retains only bounded list fields", () => {
    for (const value of ["https://evil.test/dashboard", "//evil.test/dashboard", "/dashboard/foreign", "/jobs", null]) expect(customerJobsReturn(value)).toBe("/");
    expect(customerJobsReturn("/dashboard?tab=done&q=+tap+&page=2&role=ADMIN#private")).toBe("/dashboard?tab=done&q=tap&page=2");
  });
  it("preserves a list return through the existing shared job-detail login guard", () => {
    const back = boardReturn("/dashboard?tab=done&q=tap&page=2&foreign=1");
    expect(back).toBe("/dashboard?tab=done&q=tap&page=2");
    expect(new URL(boardJobHref("job-id", back), "https://list.invalid").searchParams.get("from")).toBe(back);
    expect(boardReturn("/jobs?view=all&sort=earn")).toBe("/jobs?sort=earn&view=all");
  });
  it("the existing customer detail returns to the filtered list, retaining Home as its default", () => {
    const job = customerJobView(VIEWERS.customer, exampleJob())!;
    navigation.from = "/dashboard?tab=done&q=tap&page=2";
    expect(renderToStaticMarkup(<CustomerJobSummary job={job} />)).toContain('href="/dashboard?tab=done&amp;q=tap&amp;page=2"');
    navigation.from = null;
    const home = renderToStaticMarkup(<CustomerJobSummary job={job} />);
    expect(home).toContain('href="/"'); expect(home).toContain("Home");
  });
  it("the centralized list exposes only the assigned tradie's short name", () => {
    const source = exampleJob();
    expect(customerJobListView(VIEWERS.customer, source)?.worker).toEqual({ firstName: "Jack", lastInitial: "W" });
    for (const status of ["REVIEW", "PRICED", "BOOKABLE", "CANCELLED"] as const) expect(customerJobListView(VIEWERS.customer, { ...source, status })?.worker).toBeUndefined();
    expect(JSON.stringify(customerJobListView(VIEWERS.customer, source))).not.toMatch(/phone|email|workerId|customerId|margin|estimate/);
  });
  it("prioritizes actual customer decisions, leaving other activity in its normal order", () => {
    expect(customerJobAction("PRICED", false)).toBe("price"); expect(customerJobAction("SUBMITTED", false)).toBe("sign-off");
    expect(customerJobAction("ASSIGNED", true)).toBe("extra-work"); expect(customerJobAction("ASSIGNED", false)).toBeNull();
    for (const status of ["REVIEW", "QUOTE_BOUNTY", "BOOKABLE", "CANCEL_REVIEW", "COMPLETED", "CANCELLED"] as const) expect(customerJobAction(status, true)).toBeNull();
  });
  it.each([["active", "Nothing on yet."], ["done", "Nothing finished yet."], ["cancelled", "No cancelled jobs."]] as const)("shows the %s tab's empty state", (tab, title) => {
    const html = renderToStaticMarkup(<CustomerJobs query={{ tab, q: "", page: 1 }} data={{ rows: [], counts: { active: 0, done: 0, cancelled: 0 }, total: 0, page: 1 }} />);
    expect(html).toContain(title); expect(html).not.toMatch(/estimate|margin|workerGross|earnCents/i);
  });
  it("retains the active search and disables both responsive Reset controls only while offline", () => {
    for (const offline of [true, false]) {
      const html = renderToStaticMarkup(<CustomerJobs query={{ tab: "active", q: "not-found", page: 1 }} data={{ rows: [], counts: { active: 0, done: 0, cancelled: 0 }, total: 0, page: 1 }} previewOffline={offline} />);
      expect(html).toContain('value="not-found"');
      const controls = (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).filter(button => button.includes(">Reset filters<"));
      expect(controls).toHaveLength(2);
      for (const control of controls) {
        if (offline) { expect(control).toContain('aria-disabled="true"'); expect(control).toContain('aria-describedby='); }
        else expect(control).not.toContain('aria-disabled="true"');
      }
    }
  });
  it("separates a failed read, loading and a search with no matches", () => {
    expect(renderToStaticMarkup(<CustomerJobs query={{ tab: "active", q: "", page: 1 }} data={null} />)).toContain("Can’t load your jobs");
    const loading = renderToStaticMarkup(<CustomerJobs query={{ tab: "active", q: "", page: 1 }} data={null} loading />);
    expect(loading).toContain('aria-busy="true"'); expect(loading).not.toContain("Can’t load your jobs");
    expect(renderToStaticMarkup(<CustomerJobs query={{ tab: "active", q: "not found", page: 1 }} data={{ rows: [], counts: { active: 0, done: 0, cancelled: 0 }, total: 0, page: 1 }} />)).toContain("No jobs match that.");
  });
});
