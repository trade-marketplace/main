// Cancellations and disputes (#172, F06) without a database: the rules for what the browser sends, the words on the
// list, and every preview state rendering (the database behaviour is in office-disputes-db.test.ts).
import { randomUUID } from "node:crypto";

import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Preview } from "@/app/dev/components/office-disputes/Preview";
import { DISPUTE_PREVIEW_STATES, caseResolved, disputeAge, disputeKindLabel, disputePage, parseDisputeDecision } from "@/lib/office-disputes";
import { refundRequestId } from "@/server/office/dispute-decisions";
import { OPEN_CASE_WHERE } from "@/server/office/disputes";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/server/office/dispute-actions", () => ({ decideDisputeAction: vi.fn() }));

const JOB = randomUUID();
const base = { kind: "cancellation", jobId: JOB, decision: "refund", note: "Agreed with both.", requestId: randomUUID(), refund: { mode: "full" }, partPayoutMinutes: null };

describe("what the browser may send", () => {
  it("accepts each cancellation decision with a note, and a part payout only on a cancel", () => {
    expect(parseDisputeDecision(base)).toMatchObject({ ok: true, input: { decision: "refund", refund: { mode: "full" }, partPayoutMinutes: null } });
    expect(parseDisputeDecision({ ...base, decision: "no-refund", partPayoutMinutes: 30 })).toMatchObject({ ok: true, input: { refund: null, partPayoutMinutes: 30 } });
    // "Keep the job going" never pays or refunds, whatever is sent.
    expect(parseDisputeDecision({ ...base, decision: "keep", partPayoutMinutes: 30 })).toMatchObject({ ok: true, input: { refund: null, partPayoutMinutes: null } });
    const paymentId = randomUUID();
    expect(parseDisputeDecision({ ...base, refund: { mode: "partial", paymentId, amountCents: 5_000 } })).toMatchObject({ ok: true, input: { refund: { mode: "partial", paymentId, amountCents: 5_000 } } });
  });

  it("refuses a missing note, amount, payment or hours, naming the field", () => {
    expect(parseDisputeDecision({ ...base, note: "  " })).toMatchObject({ ok: false, field: "note", message: "Add a note. It goes on the timeline." });
    expect(parseDisputeDecision({ ...base, note: "x".repeat(501) })).toMatchObject({ ok: false, field: "note" });
    expect(parseDisputeDecision({ ...base, refund: null })).toMatchObject({ ok: false, field: "mode" });
    expect(parseDisputeDecision({ ...base, refund: { mode: "partial", paymentId: randomUUID(), amountCents: null } })).toMatchObject({ ok: false, field: "amount" });
    expect(parseDisputeDecision({ ...base, refund: { mode: "partial", paymentId: "nope", amountCents: 100 } })).toMatchObject({ ok: false, field: "paymentId" });
    // A ticked "Pay the tradie" box with no hours arrives as -1 and is refused, never paid as nothing.
    expect(parseDisputeDecision({ ...base, partPayoutMinutes: -1 })).toMatchObject({ ok: false, field: "hours", message: "Enter the hours to pay, like 1.5." });
    expect(parseDisputeDecision({ ...base, requestId: "x" })).toMatchObject({ ok: false, field: "requestId" });
    expect(parseDisputeDecision({ ...base, decision: "delete" })).toMatchObject({ ok: false, field: "decision" });
  });

  it("resolves a problem with no refund or a part refund only, against the status the office saw", () => {
    const problem = { kind: "problem", jobId: JOB, reportId: randomUUID(), seenStatus: "SUBMITTED", note: "Going back Thursday.", requestId: randomUUID(), refund: null };
    expect(parseDisputeDecision(problem)).toMatchObject({ ok: true, input: { kind: "problem", refund: null } });
    expect(parseDisputeDecision({ ...problem, refund: { mode: "full" } })).toMatchObject({ ok: false });
    expect(parseDisputeDecision({ ...problem, seenStatus: "LOST" })).toMatchObject({ ok: false, field: "seenStatus" });
  });

  it("gives each payment in a decision its own refund id, the same on every try", () => {
    const decision = randomUUID(), a = randomUUID(), b = randomUUID();
    expect(refundRequestId(decision, a)).toBe(refundRequestId(decision, a));
    expect(refundRequestId(decision, a)).not.toBe(refundRequestId(decision, b));
    expect(refundRequestId(decision, a)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("the list's words", () => {
  const now = new Date("2026-11-24T00:00:00Z");
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  it("says how long a case has waited, in days from 48 hours", () => {
    expect([disputeAge(ago(0), now), disputeAge(ago(40), now), disputeAge(ago(5 * 60), now), disputeAge(ago(47 * 60), now), disputeAge(ago(72 * 60), now)]).toEqual(["new", "40m", "5h", "47h", "3d"]);
  });
  it("names the kind of case", () => {
    expect(disputeKindLabel(["cancellation"], false)).toBe("Cancellation");
    expect(disputeKindLabel(["problem"], true)).toBe("Urgent problem");
    expect(disputeKindLabel(["cancellation", "problem"], false)).toBe("Cancellation + problem");
  });
  it("reads a page number safely and counts open cases the same way the list does", () => {
    expect([disputePage("2"), disputePage("0"), disputePage("abc"), disputePage(undefined)]).toEqual([2, 1, 1, 1]);
    expect(OPEN_CASE_WHERE).toEqual({ OR: [{ status: "CANCEL_REVIEW" }, { problems: { some: { status: "OPEN" } } }] });
    expect(caseResolved({ cancellation: null, problems: [] })).toBe(true);
  });
});

describe("every preview state renders", () => {
  for (const state of DISPUTE_PREVIEW_STATES) {
    it(state, () => {
      const html = renderToString(<Preview state={state} />);
      expect(html.length).toBeGreaterThan(100);
      if (state === "list") expect(html).toContain("Cancellations &amp; disputes");
      if (state === "empty") expect(html).toContain("All clear");
      if (state === "error") expect(html).toContain("Can’t load cases");
      if (state === "cancellation") {
        expect(html).toContain("Customer’s side");
        expect(html).toContain("Tradie’s side");
        for (const label of ["Cancel and refund", "Cancel, no refund", "Keep the job going"]) expect(html).toContain(label);
      }
      if (state === "problem") expect(html).toContain("Resolve");
      if (state === "partial-refund") {
        expect(html).toContain("Amount to refund");
        expect(html).toContain("Hours to pay");
        expect(html).toContain("Test mode.");
      }
      if (state === "decided") {
        expect(html).toContain("Resolved");
        expect(html).toContain("Cancelled with a part refund · tradie paid for part");
      }
      if (state === "refund-failed") expect(html).toContain("Stripe didn’t make that refund. Nothing was changed.");
      if (state === "offline") expect(html).toContain("You’re offline");
    });
  }
});
