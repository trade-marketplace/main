// The office's job admin view (#171): everything about one job in one read: money, messages, the full timeline
// (status history and the audit log, merged) and the tradies who could take it over. Only the office calls this
// (the page checks the role first). Nothing here is for customers or tradies, so it may show prices and pay.
import "server-only";

import type { JobStatus, Prisma, PrismaClient, Trade } from "@/generated/prisma/client";
import { TRADE_LABELS } from "@/lib/office-jobs";
import {
  fullName,
  jobNumber,
  type MessageView,
  type MoneyView,
  type OfficeJobView,
  payrollState,
  type PersonView,
  type RefundablePayment,
  timelineTitle,
  type TimelineActor,
  type TimelineEntry,
  whenLabel,
} from "@/lib/office-job";

/** Just the parts of Prisma this read uses, so tests pass a fake and nothing connects to a database. */
export type OfficeJobDatabase = {
  job: Pick<PrismaClient["job"], "findUnique">;
  auditLog: Pick<PrismaClient["auditLog"], "findMany">;
  profile: Pick<PrismaClient["profile"], "findMany">;
  estimate: Pick<PrismaClient["estimate"], "findMany">;
  supportMessage: Pick<PrismaClient["supportMessage"], "findMany">;
};

/** The timeline shows this many of the newest entries. */
export const TIMELINE_LIMIT = 200;
const MESSAGE_LIMIT = 20;
const REASSIGN_LIMIT = 100;

const SELECT = {
  id: true,
  jobNumber: true,
  title: true,
  category: true,
  status: true,
  suburb: true,
  priceCents: true,
  customerId: true,
  workerId: true,
  customer: { select: { id: true, firstName: true, lastName: true } },
  worker: { select: { id: true, firstName: true, lastName: true } },
  pricing: { select: { minutes: true, materialsCents: true, workerGrossCents: true } },
  payments: { select: { id: true, kind: true, status: true, amountCents: true, refundedCents: true }, orderBy: { createdAt: "asc" } },
  variations: { select: { id: true, status: true, priceCents: true } },
  payouts: { select: { id: true, workerId: true, status: true } },
  statusHistory: {
    select: { id: true, fromStatus: true, toStatus: true, changedById: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: TIMELINE_LIMIT,
  },
} satisfies Prisma.JobSelect;

/** The words for a status change that has no audit entry of its own (the first row is the job being posted). */
export function historyTitle(from: JobStatus | null, to: JobStatus): string {
  if (from === null) return "Posted";
  switch (to) {
    case "REVIEW":
      return "Back to pricing";
    case "QUOTE_BOUNTY":
      return "Sent to AI pricing review";
    case "PRICED":
      return "Price sent to the customer";
    case "BOOKABLE":
      return "Paid";
    case "ASSIGNED":
      return "Claimed";
    case "SUBMITTED":
      return "Sent for sign-off";
    case "COMPLETED":
      return "Signed off";
    case "CANCEL_REVIEW":
      return "Cancellation requested";
    case "CANCELLED":
      return "Cancelled";
  }
}

const PAID_STATUSES = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] as const;
const REFUNDABLE_STATUSES = ["PAID", "PARTIALLY_REFUNDED"] as const;
const PAYMENT_LABELS = { JOB: "Job", VARIATION: "Extra work", QUICK_LOOK: "Quick look" } as const;

/** Reads one job for the office. Null when there is no such job (or the id isn't a uuid). */
export async function getOfficeJob(db: OfficeJobDatabase, id: string, now: Date = new Date()): Promise<OfficeJobView | null> {
  const job = await db.job.findUnique({ where: { id }, select: SELECT });
  if (!job) return null;

  const paymentIds = job.payments.map((payment) => payment.id);
  const variationIds = job.variations.map((variation) => variation.id);
  const payoutIds = job.payouts.map((payout) => payout.id);
  const [audit, estimates, supportMessages] = await Promise.all([
    db.auditLog.findMany({
      where: {
        OR: [
          { recordType: "jobs", recordId: job.id },
          ...(paymentIds.length ? [{ recordType: "payments", recordId: { in: paymentIds } }] : []),
          ...(variationIds.length ? [{ recordType: "variations", recordId: { in: variationIds } }] : []),
          ...(payoutIds.length ? [{ recordType: "payouts", recordId: { in: payoutIds } }] : []),
        ],
      },
      select: { id: true, actorId: true, actorRole: true, action: true, before: true, after: true, reason: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: TIMELINE_LIMIT,
    }),
    db.estimate.findMany({ where: { jobId: job.id }, select: { updatedAt: true }, orderBy: { updatedAt: "desc" } }),
    db.supportMessage.findMany({
      where: { thread: { jobId: job.id }, internal: false },
      select: { id: true, body: true, fromOffice: true, createdAt: true, author: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
      take: MESSAGE_LIMIT,
    }),
  ]);

  // Everyone the timeline names: who acted, and the tradie a claim or reassignment put on the job.
  const personIds = new Set<string>();
  for (const row of audit) {
    if (row.actorId) personIds.add(row.actorId);
    const after = asRecord(row.after);
    if (typeof after?.workerId === "string") personIds.add(after.workerId);
  }
  for (const row of job.statusHistory) if (row.changedById) personIds.add(row.changedById);
  const people = personIds.size
    ? await db.profile.findMany({ where: { id: { in: [...personIds] } }, select: { id: true, firstName: true, lastName: true, role: true } })
    : [];
  const names = new Map(people.map((person) => [person.id, fullName(person)]));
  const firstNames = new Map(people.map((person) => [person.id, person.firstName]));
  const roleOf = new Map(people.map((person) => [person.id, person.role]));

  const actorOf = (id: string | null, role: string | null | undefined): TimelineActor => {
    if (!id) return "system";
    const known = role ?? roleOf.get(id);
    if (known === "ADMIN") return "office";
    if (known === "TRADIE") return "tradie";
    if (known === "CUSTOMER") return "customer";
    return id === job.customerId ? "customer" : id === job.workerId ? "tradie" : "system";
  };

  const entries: (TimelineEntry & { sort: number })[] = [];
  for (const row of audit) {
    const actor = actorOf(row.actorId, row.actorRole);
    entries.push({
      id: `audit-${row.id}`,
      actor,
      actorName: row.actorId ? (firstNames.get(row.actorId) ?? null) : null,
      title: timelineTitle({ action: row.action, before: asRecord(row.before), after: asRecord(row.after), names }),
      detail: row.reason,
      at: row.createdAt.toISOString(),
      when: whenLabel(row.createdAt, now),
      sort: row.createdAt.getTime(),
    });
  }

  // A status change the machine also audited would read twice: keep the audit entry, which has the reason.
  const audited = audit
    .map((row) => ({ at: row.createdAt.getTime(), status: asRecord(row.after)?.status }))
    .filter((row) => typeof row.status === "string");
  for (const row of job.statusHistory) {
    const at = row.createdAt.getTime();
    if (audited.some((entry) => entry.status === row.toStatus && Math.abs(entry.at - at) < 5_000)) continue;
    const actor = actorOf(row.changedById, null);
    entries.push({
      id: `status-${row.id}`,
      actor: row.fromStatus === null && !row.changedById ? "customer" : actor,
      actorName: row.changedById ? (firstNames.get(row.changedById) ?? null) : row.fromStatus === null ? job.customer.firstName : null,
      title: historyTitle(row.fromStatus, row.toStatus),
      detail: null,
      at: row.createdAt.toISOString(),
      when: whenLabel(row.createdAt, now),
      sort: at,
    });
  }
  if (estimates.length) {
    const latest = estimates[0].updatedAt;
    entries.push({
      id: "estimates",
      actor: "system",
      actorName: null,
      title: `${estimates.length} ${estimates.length === 1 ? "estimate" : "estimates"}`,
      detail: null,
      at: latest.toISOString(),
      when: whenLabel(latest, now),
      sort: latest.getTime(),
    });
  }
  entries.sort((a, b) => b.sort - a.sort);
  const timeline: TimelineEntry[] = entries.slice(0, TIMELINE_LIMIT).map((entry) => ({
    id: entry.id,
    actor: entry.actor,
    actorName: entry.actorName,
    title: entry.title,
    detail: entry.detail,
    at: entry.at,
    when: entry.when,
  }));

  const messages: MessageView[] = supportMessages
    .map((message) => ({
      id: message.id,
      from: message.fromOffice ? "Office" : message.author ? fullName(message.author) : "Someone who has left",
      fromOffice: message.fromOffice,
      body: message.body,
      at: message.createdAt.toISOString(),
      when: whenLabel(message.createdAt, now),
    }))
    .reverse();

  const paid = job.payments.filter((payment) => (PAID_STATUSES as readonly string[]).includes(payment.status));
  const payout = job.payouts.find((row) => row.workerId === job.workerId) ?? null;
  const money: MoneyView = {
    paidCents: paid.filter((payment) => payment.kind !== "VARIATION").reduce((sum, payment) => sum + payment.amountCents, 0),
    extraWorkCents: job.variations.filter((variation) => variation.status === "APPROVED").reduce((sum, variation) => sum + (variation.priceCents ?? 0), 0),
    refundedCents: job.payments.reduce((sum, payment) => sum + payment.refundedCents, 0),
    tradieEarnsCents: job.pricing?.workerGrossCents ?? null,
    payroll: payrollState(payout?.status ?? null, job.status),
  };
  const payments: RefundablePayment[] = job.payments
    .filter((payment) => (REFUNDABLE_STATUSES as readonly string[]).includes(payment.status))
    .map((payment) => ({
      id: payment.id,
      label: PAYMENT_LABELS[payment.kind],
      amountCents: payment.amountCents,
      refundableCents: Math.max(0, payment.amountCents - payment.refundedCents),
    }));

  return {
    id: job.id,
    number: jobNumber(job.jobNumber),
    title: job.title,
    status: job.status,
    trade: TRADE_LABELS[job.category],
    suburb: job.suburb,
    customer: { id: job.customer.id, name: fullName(job.customer) },
    tradie: job.worker ? { id: job.worker.id, name: fullName(job.worker) } : null,
    priceCents: job.priceCents,
    pricing: job.pricing ? { minutes: job.pricing.minutes, materialsCents: job.pricing.materialsCents } : null,
    money,
    payments,
    messages,
    timeline,
    reassignOptions:
      job.workerId && ["ASSIGNED", "SUBMITTED", "CANCEL_REVIEW"].includes(job.status) ? await reassignOptions(db, job, now) : [],
  };
}

/** Tradies who could take the job over: not the customer, not the current tradie, and licensed for the trade. */
async function reassignOptions(
  db: Pick<OfficeJobDatabase, "profile">,
  job: { customerId: string; workerId: string | null; category: Trade },
  now: Date = new Date(),
): Promise<PersonView[]> {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const people = await db.profile.findMany({
    where: {
      role: "TRADIE",
      id: { notIn: [job.customerId, ...(job.workerId ? [job.workerId] : [])] },
      workerProfile: { isNot: null },
      ...(job.category === "OTHER"
        ? {}
        : { licences: { some: { trade: job.category, status: "VERIFIED", OR: [{ expiresOn: null }, { expiresOn: { gte: today } }] } } }),
    },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: REASSIGN_LIMIT,
  });
  return people.map((person) => ({ id: person.id, name: fullName(person) }));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
