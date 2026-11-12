import { describe, expect, it } from "vitest";
import { paymentAmount, paymentDate, paymentPage, paymentRows, type PaymentRecord } from "@/lib/account/payments-list";

const paid: PaymentRecord = { id: "p1", kind: "JOB", status: "PAID", amountCents: 52000, refundedCents: 0, paidAt: new Date("2026-11-01T00:00:00Z"), refundedAt: null, job: { id: "j1", jobNumber: 1005, title: "Sub wiring" } };
describe("customer payment list rows", () => {
  it("makes one paid row and formats exact cents", () => {
    expect(paymentRows([paid])).toEqual([{ id: "p1:paid", kind: "JOB", status: "Paid", amountCents: 52000, date: "2026-11-01T00:00:00.000Z", job: paid.job }]);
    expect(paymentAmount(52000)).toBe("$520.00"); expect(paymentAmount(1)).toBe("$0.01");
  });
  it("keeps the original payment and a full refund on their separate dates", () => {
    const rows = paymentRows([{ ...paid, status: "REFUNDED", refundedCents: 52000, refundedAt: "2026-11-03T00:00:00Z" }]);
    expect(rows.map(row => [row.status, row.date, paymentAmount(row.amountCents)])).toEqual([
      ["Refunded", "2026-11-03T00:00:00.000Z", "−$520.00"], ["Paid", "2026-11-01T00:00:00.000Z", "$520.00"],
    ]);
  });
  it("shows only the partial refunded cents in its refund row", () => {
    const rows = paymentRows([{ ...paid, status: "PARTIALLY_REFUNDED", refundedCents: 12000, refundedAt: "2026-11-02T00:00:00Z" }]);
    expect(rows.map(row => row.amountCents)).toEqual([-12000, 52000]);
  });
  it("excludes pending and failed payments even if passed directly", () => {
    expect(paymentRows(["PENDING", "FAILED"].map(status => ({ ...paid, status } as PaymentRecord)))).toEqual([]);
  });
  it("orders all paid and refund rows newest first with deterministic ties", () => {
    const rows = paymentRows([{ ...paid, status: "REFUNDED", refundedCents: 52000, refundedAt: "2026-11-03T00:00:00Z" }, { ...paid, id: "p2", paidAt: "2026-11-02T00:00:00Z" }]);
    expect(rows.map(row => row.id)).toEqual(["p1:refund", "p2:paid", "p1:paid"]);
    expect(paymentRows([{ ...paid, id: "z" }, paid]).map(row => row.id)).toEqual(["p1:paid", "z:paid"]);
  });
  it("paginates expanded rows in groups of 25 and clamps invalid pages", () => {
    const rows = paymentRows(Array.from({ length: 26 }, (_, n) => ({ ...paid, id: String(n) })));
    expect(paymentPage(rows, 1).rows).toHaveLength(25); expect(paymentPage(rows, 2).rows).toHaveLength(1);
    expect(paymentPage(rows, 99)).toMatchObject({ page: 2, total: 26 });
    for (const value of [-1, NaN, Infinity, 1.1]) expect(paymentPage(rows, value).page).toBe(1);
    expect(paymentPage([], 2)).toEqual({ rows: [], page: 1, total: 0 });
  });
  it("uses Auckland dates and keeps undated legacy records visible at the end", () => {
    expect(paymentDate("2026-11-01T12:00:00Z")).toBe("2 Nov"); expect(paymentDate(null)).toBe("—");
    expect(paymentRows([{ ...paid, id: "missing", paidAt: null }, paid]).map(row => row.id)).toEqual(["p1:paid", "missing:paid"]);
  });
});
