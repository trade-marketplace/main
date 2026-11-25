import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { paymentPage, paymentRows, type PaymentPage, type RefundEvent } from "@/lib/account/payments-list";
import type { Viewer } from "@/server/auth/viewer";

/** The audit entries src/server/payments/refunds.ts writes each time a payment's refunded total moves up (#565). */
const REFUND_ACTIONS = ["payment.refunded", "payment.partially_refunded"];

/** Read-only, customer-scoped whitelist. Never import the payment mutation/provider modules here. */
export async function listCustomerPayments(db: Pick<PrismaClient, "profile" | "payment" | "auditLog">, viewer: Pick<Viewer, "userId" | "role">, page: number): Promise<PaymentPage> {
  const empty = () => paymentPage([], 1);
  if (viewer.role !== "CUSTOMER") return empty();
  const person = await db.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } });
  if (person?.role !== "CUSTOMER") return empty();
  const payments = await db.payment.findMany({
    where: { job: { customerId: viewer.userId }, status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } },
    select: { id: true, kind: true, amountCents: true, refundedCents: true, status: true, paidAt: true, refundedAt: true, job: { select: { id: true, jobNumber: true, title: true } } },
  });
  const refunded = payments.filter((payment) => payment.refundedCents > 0).map((payment) => payment.id);
  // Only this customer's own payments' entries, and only the two totals and the time from each.
  const entries = refunded.length
    ? await db.auditLog.findMany({
        where: { recordType: "payments", recordId: { in: refunded }, action: { in: REFUND_ACTIONS } },
        select: { recordId: true, before: true, after: true, createdAt: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
    : [];
  const events = new Map<string, RefundEvent[]>();
  for (const entry of entries) {
    const event = { fromCents: refundedTotal(entry.before), toCents: refundedTotal(entry.after), at: entry.createdAt };
    events.set(entry.recordId, [...(events.get(entry.recordId) ?? []), event]);
  }
  return paymentPage(paymentRows(payments.map((payment) => ({ ...payment, refunds: events.get(payment.id) ?? [] }))), page);
}

/** `refundedCents` from an audit snapshot, or NaN (which the list rejects) when it isn't a whole number of cents. */
function refundedTotal(snapshot: Prisma.JsonValue): number {
  const value = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot.refundedCents : undefined;
  return typeof value === "number" ? value : Number.NaN;
}
