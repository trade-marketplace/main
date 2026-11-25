// The office Payments ledger (#176, F11): every payment, newest first, with the filters, search, paging, totals and
// Export CSV of the All jobs list (./jobs.ts). Read only: the row's Refund button opens the job admin's refund
// dialog, which calls the job admin's own action (src/server/office/job-actions.ts → src/server/payments/refunds.ts).
// Only the office calls these (the page and the export route check the role first): Stripe ids and customers'
// emails are office-only, and nothing here is ever used by a customer or tradie page.
import "server-only";
import { notFound } from "next/navigation";

import type { JobStatus, PaymentKind, PaymentStatus, Prisma, PrismaClient } from "@/generated/prisma/client";
import { fullName } from "@/lib/office-job";
import { jobNumberLabel } from "@/lib/office-jobs";
import {
  OFFICE_PAYMENTS_EXPORT_LIMIT,
  OFFICE_PAYMENTS_PAGE_SIZE,
  type OfficePaymentsQuery,
  PAYMENT_KIND_LABELS,
  PAYMENT_STATUSES,
  paymentDateBounds,
  paymentJobNumber,
  REFUNDABLE_STATUSES,
  STATUS_FILTERS,
  TAKEN_STATUSES,
} from "@/lib/office-payments";
import { getDb } from "@/server/db";
import type { JobViewer } from "@/server/views";

import { csvCell } from "./jobs";

/** One row of the ledger, ready to show. */
export type OfficePaymentRow = {
  id: string;
  /** When it was paid; until then, when the checkout started. ISO. */
  date: string;
  job: { id: string; number: string; title: string; status: JobStatus };
  /** "Sarah Thompson". */
  customer: string;
  email: string;
  kind: PaymentKind;
  amountCents: number;
  refundedCents: number;
  /** What the office could still give back (0 unless Paid or Part refunded). */
  refundableCents: number;
  status: PaymentStatus;
  /** Stripe's PaymentIntent id (pi_…). Office only. */
  stripeId: string | null;
};

export type OfficePaymentTotals = { paidCents: number; refundedCents: number; netCents: number };

export type OfficePaymentsPage = {
  rows: OfficePaymentRow[];
  total: number;
  /** The page shown (a page past the end shows the last one). */
  page: number;
  /** Every payment that took money in the filtered list (all pages), and what was given back on them. */
  totals: OfficePaymentTotals;
};

/** Just the parts of Prisma these reads use, so tests can pass a fake. */
export type OfficePaymentsDatabase = { payment: Pick<PrismaClient["payment"], "findMany" | "count" | "aggregate"> };

const SELECT = {
  id: true,
  kind: true,
  status: true,
  amountCents: true,
  refundedCents: true,
  paidAt: true,
  createdAt: true,
  providerPaymentId: true,
  job: {
    select: {
      id: true,
      jobNumber: true,
      title: true,
      status: true,
      customer: { select: { firstName: true, lastName: true, email: true } },
    },
  },
} satisfies Prisma.PaymentSelect;

type Selected = Prisma.PaymentGetPayload<{ select: typeof SELECT }>;

/** Newest first; ties by id so paging is stable. */
const ORDER: Prisma.PaymentOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "desc" }];

/** The database filter for the list's state. Exported for tests. */
export function officePaymentsWhere(query: OfficePaymentsQuery, now: Date): Prisma.PaymentWhereInput {
  const and: Prisma.PaymentWhereInput[] = [];
  const statuses = STATUS_FILTERS[query.status].statuses;
  if (statuses) and.push({ status: { in: [...statuses] } });
  if (query.kind !== "all") and.push({ kind: query.kind });
  const bounds = paymentDateBounds(query.date, now);
  if (bounds) {
    const range = { gte: bounds.from, ...(bounds.before ? { lt: bounds.before } : {}) };
    // The date the ledger shows: paid, or (not paid yet) started.
    and.push({ OR: [{ paidAt: range }, { paidAt: null, createdAt: range }] });
  }
  const q = query.q.trim();
  if (q) {
    const number = paymentJobNumber(q);
    // Every word must be in the customer's first name, last name or email: "sarah thompson" finds Sarah Thompson.
    const words = q.split(/\s+/).slice(0, 5);
    const person = {
      AND: words.map((word) => {
        const text = { contains: word, mode: "insensitive" } as const;
        return { OR: [{ firstName: text }, { lastName: text }, { email: text }] };
      }),
    };
    and.push({ OR: [...(number !== null ? [{ job: { jobNumber: number } }] : []), { job: { customer: person } }] });
  }
  return and.length ? { AND: and } : {};
}

function toRow(payment: Selected): OfficePaymentRow {
  const refundable = REFUNDABLE_STATUSES.includes(payment.status);
  return {
    id: payment.id,
    date: (payment.paidAt ?? payment.createdAt).toISOString(),
    job: { id: payment.job.id, number: jobNumberLabel(payment.job.jobNumber), title: payment.job.title, status: payment.job.status },
    customer: fullName(payment.job.customer),
    email: payment.job.customer.email,
    kind: payment.kind,
    amountCents: payment.amountCents,
    refundedCents: payment.refundedCents,
    refundableCents: refundable ? Math.max(0, payment.amountCents - payment.refundedCents) : 0,
    status: payment.status,
    stripeId: payment.providerPaymentId,
  };
}

function requireOffice(viewer: JobViewer) {
  if (!viewer.userId || viewer.role !== "ADMIN") notFound();
}

/** A page of payments for the list's state, and the totals for the whole filtered list. */
export async function listOfficePayments(
  viewer: JobViewer,
  query: OfficePaymentsQuery,
  options: { db?: OfficePaymentsDatabase; now?: Date } = {},
): Promise<OfficePaymentsPage> {
  requireOffice(viewer);
  const { db = getDb(), now = new Date() } = options;
  const where = officePaymentsWhere(query, now);
  const [total, sums] = await Promise.all([
    db.payment.count({ where }),
    db.payment.aggregate({ where: { AND: [where, { status: { in: [...TAKEN_STATUSES] } }] }, _sum: { amountCents: true, refundedCents: true } }),
  ]);
  const lastPage = Math.max(1, Math.ceil(total / OFFICE_PAYMENTS_PAGE_SIZE));
  const page = Math.min(query.page, lastPage);
  const payments = await db.payment.findMany({ where, select: SELECT, orderBy: ORDER, skip: (page - 1) * OFFICE_PAYMENTS_PAGE_SIZE, take: OFFICE_PAYMENTS_PAGE_SIZE });
  const paidCents = sums._sum.amountCents ?? 0;
  const refundedCents = sums._sum.refundedCents ?? 0;
  return { rows: payments.map(toRow), total, page, totals: { paidCents, refundedCents, netCents: paidCents - refundedCents } };
}

/** Every payment matching the list's state (no paging), for Export CSV. At most OFFICE_PAYMENTS_EXPORT_LIMIT rows. */
export async function exportOfficePayments(
  viewer: JobViewer,
  query: OfficePaymentsQuery,
  options: { db?: OfficePaymentsDatabase; now?: Date } = {},
): Promise<{ rows: OfficePaymentRow[]; truncated: boolean }> {
  requireOffice(viewer);
  const { db = getDb(), now = new Date() } = options;
  const payments = await db.payment.findMany({ where: officePaymentsWhere(query, now), select: SELECT, orderBy: ORDER, take: OFFICE_PAYMENTS_EXPORT_LIMIT + 1 });
  return { rows: payments.slice(0, OFFICE_PAYMENTS_EXPORT_LIMIT).map(toRow), truncated: payments.length > OFFICE_PAYMENTS_EXPORT_LIMIT };
}

const dollars = (cents: number) => (cents / 100).toFixed(2);

const CSV_COLUMNS: [header: string, value: (row: OfficePaymentRow) => string][] = [
  ["Date", (row) => row.date],
  ["Job number", (row) => row.job.number],
  ["Job title", (row) => row.job.title],
  ["Customer", (row) => row.customer],
  ["Email", (row) => row.email],
  ["Kind", (row) => PAYMENT_KIND_LABELS[row.kind]],
  ["Amount (NZD incl GST)", (row) => dollars(row.amountCents)],
  ["Refunded (NZD)", (row) => dollars(row.refundedCents)],
  // The same words as the ledger's status pills.
  ["Status", (row) => PAYMENT_STATUSES[row.status].label],
  ["Stripe payment id", (row) => row.stripeId ?? ""],
  ["Payment id", (row) => row.id],
];

/** The export file: a header row, then one row per payment, CRLF line ends (what Excel expects). Cells as All jobs. */
export function officePaymentsCsv(rows: readonly OfficePaymentRow[]): string {
  const lines = [CSV_COLUMNS.map(([header]) => csvCell(header)).join(",")];
  for (const row of rows) lines.push(CSV_COLUMNS.map(([, value]) => csvCell(value(row))).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
