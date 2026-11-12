import type { PaymentKind, PaymentStatus } from "@/generated/prisma/enums";

export const PAYMENT_STATES = ["list", "with-refund", "part-refund", "empty", "page-2", "error", "offline", "loading"] as const;
export const PAYMENT_PAGE_SIZE = 25;
export type PaymentRecord = {
  id: string; kind: PaymentKind; amountCents: number; refundedCents: number; status: PaymentStatus;
  paidAt: Date | string | null; refundedAt: Date | string | null;
  job: { id: string; jobNumber: number; title: string };
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
      rows.push({ id: `${payment.id}:refund`, kind: payment.kind, amountCents: -payment.refundedCents, status: "Refunded", date: iso(payment.refundedAt), job });
    }
    return rows;
  }).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id));
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
