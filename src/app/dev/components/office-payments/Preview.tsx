"use client";
// Example data for /dev/components/office-payments (#176). Every name, job, amount and Stripe id is an example; real
// ones come from the server. Filters, search and paging run on these rows in the browser, and Refund works on this
// page's own copy (a pretend action), so a reviewer can click through the whole flow. Nothing reaches Stripe.
import { useState } from "react";

import { OfficePayments } from "@/components/office/OfficePayments";
import type { PaymentKind, PaymentStatus } from "@/generated/prisma/enums";
import {
  OFFICE_PAYMENTS_PAGE_SIZE,
  type OfficePaymentsQuery,
  type OfficePaymentsState,
  paymentDateBounds,
  paymentJobNumber,
  STATUS_FILTERS,
  TAKEN_STATUSES,
} from "@/lib/office-payments";
import type { OfficePaymentRow, OfficePaymentsPage } from "@/server/office/payments";

const NOW = new Date("2026-11-20T02:00:00Z");
const PREVIEW_PATH = "/dev/components/office-payments";

const PEOPLE = [
  ["Sarah Thompson", "sarah.thompson@example.test"],
  ["Tom Baker", "tom.baker@example.test"],
  ["Aroha Ngata", "aroha.ngata@example.test"],
  ["Priya Singh", "priya.singh@example.test"],
] as const;
const TITLES = ["Sub wiring", "Leaking outdoor tap", "Fix fence palings", "Heat pump wiring", "Hang two doors", "Gutter clean"];
const KINDS: PaymentKind[] = ["JOB", "JOB", "VARIATION", "QUICK_LOOK"];

function example(n: number): OfficePaymentRow {
  const [customer, email] = PEOPLE[n % PEOPLE.length];
  const kind = KINDS[n % KINDS.length];
  const amountCents = kind === "QUICK_LOOK" ? 3000 : kind === "VARIATION" ? 18_000 + n * 500 : 52_000 + n * 1250;
  const status: PaymentStatus = n === 1 ? "PARTIALLY_REFUNDED" : n === 4 ? "REFUNDED" : n === 2 ? "PENDING" : n === 6 ? "FAILED" : "PAID";
  const refundedCents = status === "REFUNDED" ? amountCents : status === "PARTIALLY_REFUNDED" ? 2500 : 0;
  const id = `17600000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`;
  return {
    id,
    date: new Date(NOW.getTime() - n * 26 * 60 * 60_000).toISOString(),
    job: { id: `17600000-0000-4000-8000-${String(500 + n).padStart(12, "0")}`, number: `TM-${1030 - n}`, title: TITLES[n % TITLES.length], status: n === 1 ? "ASSIGNED" : "COMPLETED" },
    customer,
    email,
    kind,
    amountCents,
    refundedCents,
    refundableCents: status === "PAID" || status === "PARTIALLY_REFUNDED" ? amountCents - refundedCents : 0,
    status,
    stripeId: status === "PENDING" ? null : `pi_3Example${String(n).padStart(4, "0")}Test`,
  };
}

const ALL: OfficePaymentRow[] = Array.from({ length: 30 }, (_, n) => example(n));

function matches(row: OfficePaymentRow, query: OfficePaymentsQuery): boolean {
  const statuses: readonly PaymentStatus[] | null = STATUS_FILTERS[query.status].statuses;
  if (statuses && !statuses.includes(row.status)) return false;
  if (query.kind !== "all" && row.kind !== query.kind) return false;
  const bounds = paymentDateBounds(query.date, NOW);
  const at = new Date(row.date).getTime();
  if (bounds && (at < bounds.from.getTime() || (bounds.before && at >= bounds.before.getTime()))) return false;
  const q = query.q.trim().toLowerCase();
  if (!q) return true;
  const number = paymentJobNumber(q);
  if (number !== null && row.job.number === `TM-${number}`) return true;
  return q.split(/\s+/).every((word) => row.customer.toLowerCase().includes(word) || row.email.toLowerCase().includes(word));
}

function pageOf(rows: readonly OfficePaymentRow[], query: OfficePaymentsQuery): OfficePaymentsPage {
  const found = rows.filter((row) => matches(row, query));
  const last = Math.max(1, Math.ceil(found.length / OFFICE_PAYMENTS_PAGE_SIZE));
  const page = Math.min(query.page, last);
  const taken = found.filter((row) => TAKEN_STATUSES.includes(row.status));
  const paidCents = taken.reduce((sum, row) => sum + row.amountCents, 0);
  const refundedCents = taken.reduce((sum, row) => sum + row.refundedCents, 0);
  return {
    rows: found.slice((page - 1) * OFFICE_PAYMENTS_PAGE_SIZE, page * OFFICE_PAYMENTS_PAGE_SIZE),
    total: found.length,
    page,
    totals: { paidCents, refundedCents, netCents: paidCents - refundedCents },
  };
}

const isDefault = (query: OfficePaymentsQuery) => query.status === "all" && query.kind === "all" && query.date === "all" && !query.q;

/** The query each state starts from when the URL has none of its own. */
function startQuery(state: OfficePaymentsState, query: OfficePaymentsQuery): OfficePaymentsQuery {
  if (!isDefault(query)) return query;
  if (state === "filtered") return { ...query, kind: "JOB", date: "30d" };
  if (state === "no-match") return { ...query, q: "nothing-matches" };
  return query;
}

const SAMPLE_CSV =
  "Date,Job number,Job title,Customer,Email,Kind,Amount (NZD incl GST),Refunded (NZD),Status,Stripe payment id,Payment id\r\n" +
  "2026-11-20T02:00:00.000Z,TM-1030,Sub wiring,Sarah Thompson,sarah.thompson@example.test,Job,520.00,0.00,Paid,pi_3Example0000Test,17600000-0000-4000-8000-000000000001\r\n";

export function PaymentsPreview({ state, query: asked }: { state: OfficePaymentsState; query: OfficePaymentsQuery }) {
  const query = startQuery(state, asked);
  const [rows, setRows] = useState<OfficePaymentRow[]>(() => (state === "empty" ? [] : ALL));
  const [recovered, setRecovered] = useState(false);
  const data = state === "loading" || (state === "error" && !recovered) ? null : pageOf(rows, query);

  // The pretend refund: moves this page's copy of the row, as the real action moves the payment.
  async function submit(input: unknown) {
    const { paymentId, mode, amountCents } = input as { paymentId: string; mode: "full" | "partial"; amountCents: number | null };
    setRows((current) =>
      current.map((row) => {
        if (row.id !== paymentId) return row;
        const giving = mode === "full" ? row.refundableCents : Math.min(row.refundableCents, amountCents ?? 0);
        const refundedCents = row.refundedCents + giving;
        const status: PaymentStatus = refundedCents >= row.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED";
        return { ...row, refundedCents, status, refundableCents: row.amountCents - refundedCents };
      }),
    );
    return { ok: true as const };
  }

  return (
    <OfficePayments
      query={query}
      data={data}
      loading={state === "loading"}
      offline={state === "offline"}
      basePath={PREVIEW_PATH}
      exportHref={() => `data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE_CSV)}`}
      submit={submit}
      refresh={() => setRecovered(true)}
      initialRefundId={state === "refund-dialog" ? ALL[0].id : null}
    />
  );
}
