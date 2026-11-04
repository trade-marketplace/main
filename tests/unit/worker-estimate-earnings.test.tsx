import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { exampleJob, VIEWERS } from "@/app/dev/components/job-views/preview-data";
import { WorkerJobBoundary } from "@/components/jobs/WorkerJobBoundary";
import { workerJobView, type WorkerJobView } from "@/server/views/jobs";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/server/jobs/worker-estimate-actions", () => ({ saveWorkerEstimateAction: vi.fn() }));
const rates = { workerRateCents: 9900, holidayPayBps: 800, minMinutes: 120 };
function details(status: "BOOKABLE" | "REVIEW" = "BOOKABLE") {
  const source = exampleJob({ status, workerId: null });
  source.pricing = { ...source.pricing!, workerGrossCents: 11000, holidayPayCents: 1345 };
  source.estimates = source.estimates.map(estimate => estimate.workerId === VIEWERS.worker.userId ? { ...estimate, minutes: 600 } : estimate);
  return workerJobView(VIEWERS.worker, source)!;
}
function render(job: WorkerJobView, earn: typeof rates | null = rates) {
  return renderToString(<WorkerJobBoundary job={job} details={job} back="/jobs?kind=estimate" earn={earn} />).replace(/<!--.*?-->/g, "");
}
describe("quote earnings after pricing", () => {
  it("shows canonical frozen earnings to the cent despite stale quoted hours and different current rates", () => {
    const html = render(details());
    expect(html).toContain("$123.45"); expect(html).not.toContain("$1,069");
    expect(html).toContain("10 h"); expect(html).not.toContain(">Edit<");
  });
  it("keeps frozen earnings when current forecast rates are unavailable", () => {
    expect(render(details(), null)).toContain("$123.45");
  });
  it("hides the earnings line when the priced DTO has no frozen amount", () => {
    const html = render({ ...details(), earnCents: null });
    expect(html).not.toContain("You’d earn"); expect(html).not.toContain("$1,069");
  });
  it("preserves the live forecast for an own quote while quotes remain open", () => {
    const html = render(details("REVIEW"));
    expect(html).toContain("$1,069"); expect(html).not.toContain("$123.45");
    expect(html).toContain(">Edit<");
  });
});
