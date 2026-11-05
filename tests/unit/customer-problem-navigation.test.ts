import { describe, expect, it } from "vitest";
import { customerProblemHref } from "@/lib/customer-problem";
import { officeProblemId, officeProblemJobHref, officeProblemJobReturn } from "@/lib/office-problem";
const job = "18200000-0000-4000-8000-000000000001", report = "18200000-0000-4000-8000-000000000002";
describe("problem report navigation", () => {
  it("keeps the saved receipt and bounded customer list context through the page guard", () => {
    const from = `/jobs/${job}?from=${encodeURIComponent("/dashboard?tab=done&q=switch&page=2")}`;
    const url = new URL(customerProblemHref(job, report, from), "https://app.test");
    expect(url.pathname).toBe(`/jobs/${job}/problem`); expect(url.searchParams.get("report")).toBe(report); expect(url.searchParams.get("from")).toBe(from);
    expect(customerProblemHref(job, [report], "https://other.test")).toBe(`/jobs/${job}/problem`);
    expect(customerProblemHref(job, "../bad?redirect=//other.test", from)).not.toContain("redirect");
  });
  it("selects one report and preserves Problems queue filters/pagination without external returns", () => {
    const back = officeProblemJobReturn({ from: "problems", problemReturn: "/admin?tab=signoff&problemPage=2#queue-problems" });
    expect(back).toEqual({ href: "/admin?tab=signoff&problemPage=2#queue-problems", label: "Problems" });
    const url = new URL(officeProblemJobHref(job, report, back), "https://app.test");
    expect(url.searchParams.get("problem")).toBe(report); expect(url.searchParams.get("from")).toBe("problems"); expect(url.searchParams.get("problemReturn")).toBe(back!.href); expect(url.hash).toBe("#problem-report");
    for (const value of ["https://other.test/admin", "//other.test/admin", "/admin/jobs", "/admin?tab=price&tab=signoff", "/admin?redirect=//other.test", "/admin\\other"]) expect(officeProblemJobReturn({ from: "problems", problemReturn: value })?.href).toBe("/admin#queue-problems");
  });
  it("does not infer the navigation origin from a selected report, or override a Support origin", () => {
    expect(officeProblemJobReturn({ problem: report })).toBeNull();
    expect(officeProblemJobReturn({ problem: report, from: "support", problemReturn: "/admin" })).toBeNull();
    expect(officeProblemJobReturn({ from: ["problems"] })).toBeNull();
    expect(officeProblemId([report])).toBeNull(); expect(officeProblemId("bad")).toBeNull(); expect(officeProblemId(report)).toBe(report);
  });
});
