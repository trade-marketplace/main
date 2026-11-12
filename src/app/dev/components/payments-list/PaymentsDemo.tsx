"use client";

import { useState } from "react";
import { PaymentsList } from "@/components/account/PaymentsList";
import { paymentPage, paymentRows, type PaymentRecord, type PAYMENT_STATES } from "@/lib/account/payments-list";

export function PaymentsDemo({ state, page }: { state: typeof PAYMENT_STATES[number]; page: number }) {
  const [recovered, setRecovered] = useState(false);
  const sample: PaymentRecord[] = [
    { id: "demo-1", kind: "JOB", amountCents: 52000, refundedCents: 0, status: "PAID", paidAt: "2026-11-04T00:00:00Z", refundedAt: null, job: { id: "00000000-0000-4000-8000-000000001005", jobNumber: 1005, title: "Sub wiring" } },
    { id: "demo-2", kind: "VARIATION", amountCents: 54000, refundedCents: 0, status: "PAID", paidAt: "2026-11-02T00:00:00Z", refundedAt: null, job: { id: "00000000-0000-4000-8000-000000000998", jobNumber: 998, title: "Fix fence palings" } },
    { id: "demo-3", kind: "QUICK_LOOK", amountCents: 12000, refundedCents: state === "with-refund" ? 12000 : state === "part-refund" ? 3000 : 0, status: state === "with-refund" ? "REFUNDED" : state === "part-refund" ? "PARTIALLY_REFUNDED" : "PAID", paidAt: "2026-10-27T00:00:00Z", refundedAt: "2026-10-28T00:00:00Z", job: { id: "00000000-0000-4000-8000-000000000971", jobNumber: 971, title: "Gutter clean" } },
  ];
  if (state === "page-2") for (let i = 4; i <= 30; i++) sample.push({ ...sample[0], id: `demo-${i}`, paidAt: new Date(Date.UTC(2026, 10, 5 + i)).toISOString(), job: { ...sample[0].job, jobNumber: 1005 + i, title: `Payment example ${i}` } });
  const data = state === "error" && !recovered ? null : paymentPage(paymentRows(state === "empty" ? [] : sample), state === "page-2" ? page : 1);
  return <PaymentsList data={data} loading={state === "loading"} offline={state === "offline" ? true : undefined} onRetry={() => setRecovered(true)} pageHref={page => `/dev/components/payments-list?state=page-2&page=${page}`} />;
}
