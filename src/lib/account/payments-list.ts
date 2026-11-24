import type { PaymentKind, PaymentStatus } from "@/generated/prisma/enums";

export const PAYMENT_STATES = ["list", "with-refund", "part-refund", "two-refunds", "empty", "page-2", "error", "offline", "loading"] as const;
export const PAYMENT_PAGE_SIZE = 25;
/**
 * One confirmed refund (#565): the payment's refunded total before and after it, and when it was recorded. Read from
 * the payment's `payment.refunded` / `payment.partially_refunded` audit entries, which src/server/payments/refunds.ts
 * writes once per move of the total (office or webhook, never both), in the transaction that moved it. Numbers and a
 * time only: nothing else from the entry (Stripe ids, notes, payroll flags) is ever copied here.
 */
export type RefundEvent = { fromCents: number; toCents: number; at: Date | string };
export type PaymentRecord = {
  id: string; kind: PaymentKind; amountCents: number; refundedCents: number; status: PaymentStatus;
  paidAt: Date | string | null; refundedAt: Date | string | null;
  job: { id: string; jobNumber: number; title: string };
  /** The payment's confirmed refunds, any order. Without them (or if they don't add up) one total refund row shows. */
  refunds?: readonly RefundEvent[];
};
export type PaymentRow = {
  id: string; kind: PaymentKind; amountCents: number; status: "Paid" | "Refunded"; date: string | null;
  job: { id: string; jobNumber: number; title: string };
};
export type PaymentPage = { rows: PaymentRow[]; page: number; total: number };
const iso = (date: Date | string | null) => date === null ? null : new Date(date).toISOString();

/** Expand before ordering/paging: a refund belongs on its own date, including on another page. */
export function paymentRows(payments: readonly PaymentRecord[]): PaymentRow[] {
  return payments.flatMap((payment): PaymentRow[] => {
    if (!["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status)) return [];
    // Rebuild every object explicitly: provider fields cannot hitch a ride to the browser.
    const job = { id: payment.job.id, jobNumber: payment.job.jobNumber, title: payment.job.title };
    const rows: PaymentRow[] = [{ id: `${payment.id}:paid`, kind: payment.kind, amountCents: payment.amountCents, status: "Paid", date: iso(payment.paidAt), job }];
    if (payment.refundedCents > 0 && (payment.status === "PARTIALLY_REFUNDED" || payment.status === "REFUNDED")) {
      const events = refundChain(payment.refunds ?? [], payment.refundedCents);
      if (events) {
        // Each confirmed refund on its own date with its own amount, numbered oldest first (stable across pages).
        events.forEach((event, n) => rows.push({ id: `${payment.id}:refund:${n + 1}`, kind: payment.kind, amountCents: -(event.toCents - event.fromCents), status: "Refunded", date: iso(event.at), job }));
      } else {
        rows.push({ id: `${payment.id}:refund`, kind: payment.kind, amountCents: -payment.refundedCents, status: "Refunded", date: iso(payment.refundedAt), job });
      }
    }
    return rows;
  }).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id));
}

/**
 * The refunds, oldest first, only when they account for the whole refunded total with nothing missing or counted
 * twice: each starts where the last ended, from 0 up to `refundedCents`. A replayed entry for a total already seen
 * is dropped. Anything else (an older payment with no entries, a gap) answers null, and the list falls back to one
 * total refund row, so the amounts a customer sees always add up to what was refunded.
 */
export function refundChain(events: readonly RefundEvent[], refundedCents: number): RefundEvent[] | null {
  const byTotal = new Map<number, RefundEvent>();
  for (const event of events) {
    const valid = Number.isSafeInteger(event.fromCents) && Number.isSafeInteger(event.toCents) && event.fromCents >= 0 && event.toCents > event.fromCents;
    if (valid && !Number.isNaN(new Date(event.at).getTime()) && !byTotal.has(event.toCents)) byTotal.set(event.toCents, event);
  }
  const chain = [...byTotal.values()].sort((a, b) => a.toCents - b.toCents);
  let reached = 0;
  for (const event of chain) {
    if (event.fromCents !== reached) return null;
    reached = event.toCents;
  }
  return chain.length && reached === refundedCents ? chain : null;
}
export function paymentPage(rows: readonly PaymentRow[], requested: number): PaymentPage {
  const last = Math.max(1, Math.ceil(rows.length / PAYMENT_PAGE_SIZE));
  const page = Math.min(last, Math.max(1, Number.isSafeInteger(requested) ? requested : 1));
  return { rows: rows.slice((page - 1) * PAYMENT_PAGE_SIZE, page * PAYMENT_PAGE_SIZE), page, total: rows.length };
}
export const paymentKindLabel = (kind: PaymentKind) => ({ JOB: "Fixed price", VARIATION: "Extra work", QUICK_LOOK: "Quick look" })[kind];
const money = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" });
export const paymentAmount = (cents: number) => `${cents < 0 ? "−" : ""}${money.format(Math.abs(cents) / 100)}`;
export const paymentDate = (date: string | null) => date ? new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", timeZone: "Pacific/Auckland" }).format(new Date(date)) : "—";
