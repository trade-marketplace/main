import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkerEstimateSummary } from "@/components/jobs/WorkerEstimateParts";
const own = { minutes: 150, materialsCents: 12000, note: null, needsSiteVisit: false, madeBeforeEdit: true };
describe("edited-job estimate guidance", () => {
  it("asks the worker to check and resend an editable stale estimate", () => {
    const html = renderToString(<WorkerEstimateSummary own={own} canEdit />);
    expect(html).toContain("Job updated"); expect(html).toContain("Check your estimate and send it again.");
  });
  it("does not ask for a resend when pricing or eligibility prevents editing", () => {
    const html = renderToString(<WorkerEstimateSummary own={own} canEdit={false} />);
    expect(html).toContain("Job updated"); expect(html).not.toContain("send it again");
  });
  it("clears the guidance once the worker has resubmitted", () => {
    const html = renderToString(<WorkerEstimateSummary own={{ ...own, madeBeforeEdit: false }} />);
    expect(html).not.toContain("Job updated"); expect(html).not.toContain("send it again");
  });
});
