// Materials repayment (#512) without a database: the money rule, what the office may send, the words on the card, the
// Payouts page's "Materials to check" blocker and the Earnings line. The database side: materials-repayment-db.test.ts.
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { JobMaterialsCard } from "@/components/office/JobMaterialsCard";
import { OfficePayouts, exportedNotice } from "@/components/office/OfficePayouts";
import { buildEarnings, payoutLine, payoutTotal, type PayoutRecord } from "@/lib/earnings";
import { decisionFromAudit, exportedMaterialsFromAudit, materialsRepayment } from "@/lib/materials-repayment";
import { parseMaterialsDecision, repaidLabel, type OfficeMaterialsView } from "@/lib/office/materials";
import type { OfficePayoutsData, PayoutBatch } from "@/lib/office/payouts";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/server/auth/guard", () => ({ withRole: (_roles: unknown, handler: unknown) => handler }));

const JOB = "00000000-0000-4000-8000-000000001012";
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("the repayment rule", () => {
  const plumbing = (budgetCents: number, spentCents: number | null) => ({ category: "PLUMBING" as const, materials: { budgetCents, spentCents } });

  it("repays a spend within budget automatically", () => {
    expect(materialsRepayment(plumbing(12_000, 9_840), null)).toEqual({ state: "auto", repaidCents: 9_840 });
    expect(materialsRepayment(plumbing(12_000, 12_000), null)).toEqual({ state: "auto", repaidCents: 12_000 });
  });

  it("holds a spend over budget until the office decides, then repays what it decided", () => {
    expect(materialsRepayment(plumbing(12_000, 14_650), null)).toEqual({ state: "to-check", repaidCents: 0 });
    expect(materialsRepayment(plumbing(12_000, 14_650), { repaidCents: 13_500, spentCents: 14_650 })).toEqual({ state: "decided", repaidCents: 13_500 });
    expect(materialsRepayment(plumbing(12_000, 14_650), { repaidCents: 0, spentCents: 14_650 })).toEqual({ state: "decided", repaidCents: 0 });
  });

  it("what if the spend changed after the decision (sent back and resent)? It needs checking again", () => {
    expect(materialsRepayment(plumbing(12_000, 16_000), { repaidCents: 14_650, spentCents: 14_650 })).toEqual({ state: "to-check", repaidCents: 0 });
  });

  it("what if a decision is malformed or more than the spend? It doesn't count, so the payout stays held", () => {
    expect(materialsRepayment(plumbing(12_000, 14_650), { repaidCents: 20_000, spentCents: 14_650 }).state).toBe("to-check");
    expect(decisionFromAudit({ repaidCents: "1" })).toBeNull();
    expect(decisionFromAudit(null)).toBeNull();
    expect(decisionFromAudit({ repaidCents: 100, spentCents: 200 })).toEqual({ repaidCents: 100, spentCents: 200 });
  });

  it("repays nothing on electrical jobs, with no budget spend, or before the spend is reported", () => {
    expect(materialsRepayment({ category: "ELECTRICAL", materials: { budgetCents: 8_500, spentCents: 9_900 } }, null)).toEqual({ state: "none", repaidCents: 0 });
    expect(materialsRepayment(plumbing(12_000, null), null).state).toBe("none");
    expect(materialsRepayment(plumbing(12_000, 0), null).state).toBe("none");
    expect(materialsRepayment({ category: "OTHER", materials: null }, null).state).toBe("none");
  });

  it("reads the figure an export froze; exports from before #512 repaid nothing", () => {
    expect(exportedMaterialsFromAudit({ status: "EXPORTED", materialsCents: 9_840 })).toBe(9_840);
    expect(exportedMaterialsFromAudit({ status: "EXPORTED" })).toBe(0);
    expect(exportedMaterialsFromAudit({ materialsCents: -5 })).toBe(0);
  });
});

describe("what the office sends", () => {
  const base = { jobId: JOB, seenSpentCents: 14_650, note: "Receipt matches." };
  it("needs a note, and a Change amount from $0 up to the spend", () => {
    expect(parseMaterialsDecision({ ...base, kind: "approve" })).toEqual({ ok: true, input: { ...base, kind: "approve" } });
    expect(parseMaterialsDecision({ ...base, kind: "approve", note: "  " })).toMatchObject({ ok: false, field: "note" });
    expect(parseMaterialsDecision({ ...base, kind: "change", repaidCents: 13_500 })).toMatchObject({ ok: true, input: { repaidCents: 13_500 } });
    expect(parseMaterialsDecision({ ...base, kind: "change", repaidCents: 0 })).toMatchObject({ ok: true });
    expect(parseMaterialsDecision({ ...base, kind: "change", repaidCents: 14_651 })).toMatchObject({ ok: false, field: "amount", message: "Enter up to $146.50, the spend." });
    expect(parseMaterialsDecision({ ...base, kind: "change", repaidCents: -1 })).toMatchObject({ ok: false, field: "amount" });
    expect(parseMaterialsDecision({ ...base, kind: "change" })).toMatchObject({ ok: false, field: "amount" });
    expect(parseMaterialsDecision({ ...base, kind: "refund" })).toMatchObject({ ok: false, field: "form" });
    expect(parseMaterialsDecision({ ...base, jobId: "not-a-job", kind: "approve" })).toMatchObject({ ok: false, field: "form" });
  });
});

describe("the Materials card", () => {
  const view = (overrides: Partial<OfficeMaterialsView> = {}): OfficeMaterialsView => ({
    budgetCents: 12_000, spentCents: 14_650, receipt: { url: "https://files.test/r.pdf?signed" }, reason: "Out of the 15 mm valve.",
    state: "to-check", repaidCents: 0, decision: null, sent: false, canDecide: true, ...overrides,
  });
  const render = (materials: OfficeMaterialsView) =>
    text(renderToString(<JobMaterialsCard jobId={JOB} materials={materials} tradie="Jack Wilson" decide={async () => ({ ok: true, repaidCents: 0 })} onDone={() => {}} />));

  it("shows the budget, spend, receipt, reason, the hold and both decisions when over budget", () => {
    const html = render(view());
    for (const words of ["Budget $120.00", "Spend $146.50", "Over budget $26.50", "Open receipt", "Repaid Held until checked", "Why it was over", "“Out of the 15 mm valve.”", "The payout is held until you check the receipt.", "Approve spend", "Change amount"]) expect(html).toContain(words);
  });

  it("says what was decided, by whom, and offers no decisions once sent to payroll", () => {
    const decision = { kind: "changed" as const, repaidCents: 13_500, by: "Matt", at: "2026-11-02T00:40:00.000Z", when: "11:40 today", note: "Part was for another job." };
    const html = render(view({ state: "decided", repaidCents: 13_500, decision, sent: true, canDecide: false }));
    expect(html).toContain("Repaid $135.00 · amount changed");
    expect(html).toContain("Amount changed by Matt · 11:40 today");
    expect(html).toContain("Sent to payroll");
    expect(html).not.toContain("Approve spend");
  });

  it("within budget, not reported yet, and a receipt that couldn't be loaded", () => {
    expect(render(view({ spentCents: 9_840, reason: null, state: "auto", repaidCents: 9_840, canDecide: false }))).toContain("Repaid $98.40 · within budget");
    const notReported = render(view({ spentCents: null, receipt: null, reason: null, state: "not-reported", canDecide: false }));
    expect(notReported).toContain("Spend Not reported yet");
    expect(notReported).not.toContain("Receipt");
    expect(render(view({ receipt: { url: null } }))).toContain("Couldn’t load the receipt");
    expect(repaidLabel(view({ state: "decided", repaidCents: 14_650, decision: { kind: "approved", repaidCents: 14_650, by: null, at: "", when: "", note: null } }))).toBe("$146.50 · approved");
  });
});

describe("the Payouts page and Earnings", () => {
  const data: OfficePayoutsData = {
    payday: "2026-11-20",
    ready: { count: 0, tradies: 0, totalCents: 0, grossCents: 0, holidayPayCents: 0, materialsCents: 0 },
    blocked: { tradies: 0, payouts: 0, names: [] },
    materials: { payouts: 1, jobs: [{ jobId: JOB, jobNumber: "TM-1012" }] },
    rows: [{ id: "p1", tradie: "Jack Wilson", jobId: JOB, jobNumber: "TM-1012", title: "Valves", signedOffAt: "2026-11-02T22:00:00Z", minutes: 120, holidayPayCents: 1120, materialsCents: 0, totalCents: 15_120, blockers: ["materials"] }],
    batches: [],
  };

  it("lists Materials to check with a link to the job, and the row's pill", () => {
    const html = renderToString(<OfficePayouts data={data} refresh={() => {}} />);
    expect(text(html)).toContain("Materials to check. 1 payout is held back until the receipt is checked: TM-1012");
    expect(html).toContain(`href="/admin/jobs/${JOB}"`);
    expect(html).toContain("Check materials on TM-1012");
    expect(text(html)).toContain("Nobody held back");
  });

  it("says why payouts were held back after an export", () => {
    const batch: PayoutBatch = { key: "2026-11-20T02:12:00.000Z", payday: "2026-11-20", count: 2, tradies: 1, totalCents: 10_000, status: "EXPORTED", paidAt: null };
    expect(exportedNotice(batch, 3, "#", 1).text).toBe("Exported 2 payouts · $100.00 for Fri 20 Nov. 2 payouts held back for missing payroll details. 1 payout held back for materials to check.");
    expect(exportedNotice(batch, 1, "#", 1).text).toBe("Exported 2 payouts · $100.00 for Fri 20 Nov. 1 payout held back for materials to check.");
    expect(exportedNotice(batch, 1, "#").text).toBe("Exported 2 payouts · $100.00 for Fri 20 Nov. 1 payout held back for missing payroll details.");
  });

  it("Earnings shows the materials on the payout line and in the totals, or that they're being checked", () => {
    const record = (overrides: Partial<PayoutRecord>): PayoutRecord => ({ id: "p1", jobNumber: "TM-1012", title: "Valves", minutes: 120, rateCents: 7000, grossCents: 14_000, holidayPayCents: 1_120, status: "QUEUED", createdAt: "2026-11-16T22:00:00Z", paidAt: null, ...overrides });
    expect(payoutTotal(record({ materialsCents: 9_840 }))).toBe(24_960);
    expect(payoutLine(record({ materialsCents: 9_840 }))).toMatchObject({ materials: "$98.40", total: "$249.60" });
    expect(payoutLine(record({ materialsHeld: true }))).toMatchObject({ materials: "Being checked", total: "$151.20" });
    expect(payoutLine(record({}))).toMatchObject({ materials: null });
    const view = buildEarnings({ payouts: [record({ materialsCents: 9_840 })], waiting: [], now: new Date("2026-11-18T02:00:00Z") });
    expect(view.next.totalCents).toBe(24_960);
  });
});
