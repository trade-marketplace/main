import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MyWorkCard } from "@/components/mywork/MyWorkCard";
import { MyQuotes } from "@/components/mywork/MyQuotes";
import { MyWork } from "@/components/mywork/MyWork";
import { previewJob, previewQuotes, previewWork, PREVIEW_NOW } from "@/app/dev/components/my-work/preview-data";
import { hoursLeft, myWorkColumn, myWorkHref, myWorkPill, myWorkSecondLine, parseMyWorkQuery, quoteOutcome } from "@/lib/my-work";
import { boardJobHref, boardReturn } from "@/lib/job-board";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const now = new Date(PREVIEW_NOW), query = { tab: "jobs", column: "to-book" } as const;
describe("My work next moves and safe navigation", () => {
  it.each([
    [{}, "to-book", "Book a time"],
    [{ bookedDate: "2026-11-12", bookedTime: "MORNING" }, "on-now", "Booked in"],
    [{ bookedDate: "2026-11-12", bookedTime: "MORNING", openExtraWork: 1 }, "on-now", "Waiting on OK"],
    [{ status: "CANCEL_REVIEW" }, "on-now", "On hold"],
    [{ status: "SUBMITTED", submittedAt: "2026-11-11T00:00:00Z" }, "waiting-sign-off", "46h left"],
    [{ status: "SUBMITTED", openProblems: 1 }, "waiting-sign-off", "Paused"],
    [{ status: "SUBMITTED" }, "waiting-sign-off", "Waiting sign-off"],
    [{ status: "COMPLETED" }, "done", "Queued"],
    [{ status: "COMPLETED", payout: "Paid" }, "done", "Paid"],
  ] as const)("maps %j to %s / %s", (changes, column, label) => {
    const job = previewJob(1, changes); expect(myWorkColumn(job)).toBe(column); expect(myWorkPill(job, 48, now).label).toBe(label);
  });
  it("uses the configured sign-off hours, rounds up and never goes below zero", () => {
    expect(hoursLeft("2026-11-11T00:01:00Z", 24, now)).toBe(23);
    expect(hoursLeft("2026-11-01T00:00:00Z", 48, now)).toBe(0);
    expect(hoursLeft(null, 48, now)).toBeNull(); expect(hoursLeft("invalid", 48, now)).toBeNull();
  });
  it("uses NZ today for claims, date-only booking days and actual sent/completed dates", () => {
    expect(myWorkSecondLine(previewJob(1), now)).toBe("Windsor · claimed today");
    expect(myWorkSecondLine(previewJob(1, { claimedAt: "2026-11-09T00:00:00Z" }), now)).toBe("Windsor · claimed Mon 9 Nov");
    expect(myWorkSecondLine(previewJob(1, { bookedDate: "2026-11-12", bookedTime: "MORNING" }), now)).toBe("Windsor · Thu 12 Nov · Morning");
    expect(myWorkSecondLine(previewJob(1, { status: "SUBMITTED", submittedAt: "2026-11-09T00:00:00Z" }), now)).toBe("Windsor · done Mon");
    expect(myWorkSecondLine(previewJob(1, { status: "COMPLETED", completedAt: "2026-10-31T00:00:00Z" }), now)).toBe("Windsor · 31 Oct");
    expect(myWorkSecondLine(previewJob(1, { claimedAt: "2026-11-10T10:30:00Z" }), new Date("2026-11-10T11:30:00Z"))).toBe("Windsor · claimed Tue 10 Nov");
    expect(myWorkSecondLine(previewJob(1, { claimedAt: null }), now)).toBe("Windsor");
  });
  it.each([["REVIEW", null, "Waiting"], ["QUOTE_BOUNTY", null, "Waiting"], ["PRICED", null, "Priced"], ["ASSIGNED", "own", "Taken by you"], ["ASSIGNED", "other", "Not taken"], ["CANCELLED", null, "Not taken"]] as const)("shows the own quote outcome for %s", (status, workerId, expected) => {
    expect(quoteOutcome(status, workerId, "own")).toBe(expected);
  });
  it("bounds worker tabs/columns without changing existing customer dashboard returns", () => {
    expect(parseMyWorkQuery({ tab: ["quotes"], column: "foreign" })).toEqual(query);
    expect(boardReturn("/dashboard?tab=quotes&column=done&workerId=foreign#private")).toBe("/dashboard?tab=quotes&column=done");
    expect(boardReturn("/dashboard?column=on-now")).toBe("/dashboard?column=on-now");
    expect(boardReturn("/dashboard?tab=done&q=tap&page=2")).toBe("/dashboard?tab=done&q=tap&page=2");
    expect(boardReturn("/dashboard?tab=done&q=tap&page=2&column=on-now")).toBe("/dashboard?tab=done&q=tap&page=2");
    for (const value of ["https://evil.test/dashboard?tab=quotes", "//evil.test/dashboard?tab=quotes", "/dashboard/foreign?tab=quotes", "/dashboard\\evil?tab=quotes"]) expect(boardReturn(value)).toBe("/jobs");
    expect(new URL(boardJobHref("job", "/dashboard?tab=quotes"), "https://work.invalid").searchParams.get("from")).toBe("/dashboard?tab=quotes");
    expect(myWorkHref(query)).toBe("/dashboard");
  });
  it("renders a single job link with only the worker pay, never a customer price", () => {
    const job = { ...previewJob(1), priceCents: 999999, marginCents: 444444 };
    const html = renderToStaticMarkup(<MyWorkCard job={job} query={query} autoReleaseHours={48} now={now} />);
    expect(html.match(/<a\b/g)).toHaveLength(1); expect(html).toContain("$259.20"); expect(html).toContain("Earn");
    expect(html).not.toMatch(/999999|9,999|444444|marginCents|priceCents/);
  });
  it("keeps restricted quote history visible but noninteractive", () => {
    const quotes = previewQuotes();
    const html = renderToStaticMarkup(<MyQuotes data={quotes} query={{ ...query, tab: "quotes" }} />);
    for (const row of quotes.rows) {
      expect(html).toContain(row.title);
      if (row.canOpen) expect(html).toContain(`/jobs/${row.jobId}?from=%2Fdashboard%3Ftab%3Dquotes`);
      else expect(html).not.toContain(`/jobs/${row.jobId}?`);
    }
    expect(html).not.toMatch(/workerId|customerId|priceCents|materialsCents|margin/);
  });
  it("distinguishes empty, failed and loading reads without inventing zero earnings", () => {
    expect(renderToStaticMarkup(<MyWork query={query} work={previewWork("empty")} quotes={previewQuotes(true)} />)).toContain("No jobs yet.");
    expect(renderToStaticMarkup(<MyWork query={query} work={null} quotes={null} />)).toContain("Couldn’t load your work.");
    const html = renderToStaticMarkup(<MyWork query={query} work={null} quotes={null} loading />);
    expect(html).toContain('aria-busy="true"'); expect(html).not.toContain("No jobs yet."); expect(html).not.toContain("0 jobs on");
  });
});
