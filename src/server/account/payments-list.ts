import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { paymentPage, paymentRows, type PaymentPage } from "@/lib/account/payments-list";
import type { Viewer } from "@/server/auth/viewer";

/** Read-only, customer-scoped whitelist. Never import the payment mutation/provider modules here. */
export async function listCustomerPayments(db: Pick<PrismaClient, "profile" | "payment">, viewer: Pick<Viewer, "userId" | "role">, page: number): Promise<PaymentPage> {
  const empty = () => paymentPage([], 1);
  if (viewer.role !== "CUSTOMER") return empty();
  const person = await db.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } });
  if (person?.role !== "CUSTOMER") return empty();
  const payments = await db.payment.findMany({
    where: { job: { customerId: viewer.userId }, status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } },
    select: { id: true, kind: true, amountCents: true, refundedCents: true, status: true, paidAt: true, refundedAt: true, job: { select: { id: true, jobNumber: true, title: true } } },
  });
  return paymentPage(paymentRows(payments), page);
}
