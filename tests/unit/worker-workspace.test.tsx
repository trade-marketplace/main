import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Workspace } from "@/components/jobs/worker/Workspace";
import { workspaceExample } from "@/app/dev/components/worker-workspace/WorkspaceDemo";
import { claimDateLabel, signOffHours } from "@/lib/worker-workspace";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const html = (job = workspaceExample) => renderToStaticMarkup(<Workspace job={job} />);
afterEach(() => vi.useRealTimers());
describe("worker workspace", () => {
  it("uses Earn and forwards no customer pricing, estimates, margin or long customer name", () => {
    const body = html();
    expect(body).toContain("Earn $259.20"); expect(body).toContain("Sarah T.");
    expect(body).not.toMatch(/You earn|customerPrice|priceCents|margin|estimate|Thompson/);
    expect(body).toContain("tel:0215550192"); expect(body).toContain("maps/dir/?api=1"); expect(body).toContain('rel="noopener"');
  });
  it("shows Telfer and keyboard copy only for electrical, and omits absent or zero budgets", () => {
    expect(html()).toContain("Telfer job no."); expect(html()).toContain("Copy TM-1005");
    const other = html({ ...workspaceExample, category: "PLUMBING" }); expect(other).not.toContain("Telfer"); expect(other).toContain("Keep your receipt. You’ll add it when you finish.");
    expect(html({ ...workspaceExample, budgetCents: null })).not.toContain("Budget");
    expect(html({ ...workspaceExample, budgetCents: 0 })).not.toContain("$0.00");
    expect(html({ ...workspaceExample, category: "OTHER", budgetCents: 0 })).not.toContain('aria-label="Materials"');
  });
  it.each(["SUBMITTED", "COMPLETED", "CANCEL_REVIEW"] as const)("%s is read-only without update or finish controls", status => {
    const body = html({ ...workspaceExample, status });
    expect(body).not.toContain("I’m on my way"); expect(body).not.toContain("Running late"); expect(body).not.toContain("Customer not home");
    expect(body).not.toContain("Finish job"); expect(body).not.toContain('>Change<');
    expect(body).toContain(status === "SUBMITTED" ? "Sent for sign-off." : status === "COMPLETED" ? "Signed off." : "On hold");
  });
  it("shows all assigned updates and links to the planned routes with one Messages link", () => {
    const body = html(); for (const label of ["I’m on my way", "Running late", "Need to reschedule", "Customer not home"]) expect(body).toContain(label);
    expect(body).toContain(`/jobs/${workspaceExample.id}/book`); expect(body).toContain(`/jobs/${workspaceExample.id}/complete`);
    expect(body.match(/href="\/messages"/g)).toHaveLength(1); expect(body).toContain("Extra work</");
  });
  it("disables Finish job with the extra-work reason", () => {
    const body = html({ ...workspaceExample, extraWorkOpen: true });
    expect(body).toContain("Extra work sent. Waiting on the customer’s OK."); expect(body).toContain('aria-disabled="true"'); expect(body).not.toContain(`/jobs/${workspaceExample.id}/complete`);
  });
  it("uses the configured sign-off window and clamps expired time at zero", () => {
    expect(signOffHours("2026-11-11T12:00:00Z", Date.parse("2026-11-09T14:01:00Z"))).toBe(46);
    expect(signOffHours("2026-11-11T12:00:00Z", Date.parse("2026-11-12T12:00:00Z"))).toBe(0);
    expect(html({ ...workspaceExample, autoReleaseHours: 72 })).toContain("or 72 hours");
  });
  it("uses Auckland dates for claimed today without inventing legacy claim dates", () => {
    expect(claimDateLabel("2026-11-10T12:00:00Z", new Date("2026-11-11T02:00:00Z"))).toBe("claimed today");
    expect(claimDateLabel(null)).toBeNull(); expect(html({ ...workspaceExample, claimedAt: null, earnCents: null })).not.toContain("claimed today");
    expect(html({ ...workspaceExample, earnCents: null })).not.toContain("Earn $");
  });
});
