import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { canCancelJob, cancelReasonSchema, cancelRevision } from "@/lib/customer-cancel";
import { CancelJobDialog } from "@/components/jobs/customer/CancelJobDialog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("customer cancellation contract", () => {
  it("offers cancellation only in waiting, bookable and assigned states", () => {
    for (const status of ["REVIEW", "QUOTE_BOUNTY", "BOOKABLE", "ASSIGNED"] as const) expect(canCancelJob(status)).toBe(true);
    for (const status of ["PRICED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW", "CANCELLED"] as const) expect(canCancelJob(status)).toBe(false);
  });
  it("requires 3 to 500 trimmed reason characters", () => {
    for (const text of ["", "  a  ", "x".repeat(501)]) expect(cancelReasonSchema.safeParse(text).success).toBe(false);
    expect(cancelReasonSchema.parse("  No longer needed.  ")).toBe("No longer needed.");
  });
  it("binds revisions to the status as well as update time", () => expect(cancelRevision("now", "REVIEW")).not.toBe(cancelRevision("now", "BOOKABLE")));
  it("does not render a cancel trigger once the state no longer permits it", () => {
    expect(renderToStaticMarkup(<CancelJobDialog jobId="job" revision="revision" facts={{ canCancel: false, paid: true, workerFirstName: "Jack", onTheWay: true }} online />)).toBe("");
  });
  it("requires the paid reason field and shows the call-out warning only for an on-the-way tradie", () => {
    for (const paid of [false, true]) for (const onTheWay of [false, true]) {
      const html = renderToStaticMarkup(<CancelJobDialog jobId="job" revision="revision" facts={{ canCancel: true, paid, workerFirstName: "Jack", onTheWay }} online preview="paid" />);
      expect(html.includes('name="reason"')).toBe(paid);
      expect(html.includes("A call-out fee may apply.")).toBe(paid && onTheWay);
      if (paid) expect(html).toContain('required=""');
      else expect(html).toContain("It’s free to cancel.");
    }
  });
});
