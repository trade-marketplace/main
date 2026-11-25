// Cancellations and disputes (#172, F06): the office's open cases and one case in full. Office only: every read
// checks the viewer's role against their profile first. Nothing here is for customers or tradies, so it may show
// prices and pay. The decisions are in ./dispute-decisions.ts; the words and types in src/lib/office-disputes.ts.
import "server-only";

import type { JobStatus, Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  disputeAge,
  disputeHref,
  disputeKindLabel,
  DISPUTES_PAGE_SIZE,
  type DisputeCaseView,
  type DisputeDecisionEntry,
  type DisputeKind,
  type DisputeListData,
  type DisputePayment,
  type DisputeProblem,
  type DisputeRow,
  type DisputeUpdate,
} from "@/lib/office-disputes";
import { fullName, jobNumber, OFFICE_JOB_PATH, payrollState, timelineTitle, whenLabel } from "@/lib/office-job";
import { TRADE_LABELS } from "@/lib/office-jobs";
import type { JobViewer } from "@/server/views";
import { createSupabaseFileStore, PHOTO_BUCKET, SIGNED_URL_SECONDS } from "@/server/files/storage";

type Db = Pick<PrismaClient, "profile" | "job" | "auditLog">;

/** Open cases are few; this many is read and sorted at once. */
export const DISPUTE_LIST_LIMIT = 1000;

const PAID = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] as const;
const REFUNDABLE = ["PAID", "PARTIALLY_REFUNDED"] as const;
const PAYMENT_LABELS = { JOB: "Job", VARIATION: "Extra work", QUICK_LOOK: "Quick look" } as const;

/** What the tradie did on the job that the office reads as their side of it. */
export const TRADIE_UPDATE_ACTIONS = [
  "job.claimed",
  "job.window_booked",
  "job.times_requested",
  "job.on_my_way",
  "job.running_late",
  "job.customer_not_home",
  "job.materials_reported",
  "job.submitted",
  "job.released",
] as const;

/** Decisions the office made on a case, shown under "Decided". */
const DECISION_ACTIONS = ["job.cancel_approved", "job.reinstated", "job.cancelled", "job.status_overridden"] as const;

const DECISION_TITLES: Record<string, string> = {
  "job.cancel_approved": "Cancelled",
  "job.reinstated": "Kept going",
  "job.cancelled": "Cancelled from the job page",
  "job.status_overridden": "Status forced",
};

async function isOffice(db: Pick<PrismaClient, "profile">, viewer: JobViewer) {
  if (!viewer.userId || viewer.role !== "ADMIN") return false;
  return (await db.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } }))?.role === "ADMIN";
}

const name = (person: { firstName: string; lastName: string | null } | null | undefined) => (person ? fullName(person) : null);

/** A case is waiting when the job is in CANCEL_REVIEW or has an OPEN problem report. */
export const OPEN_CASE_WHERE = { OR: [{ status: "CANCEL_REVIEW" }, { problems: { some: { status: "OPEN" } } }] } satisfies Prisma.JobWhereInput;

const LIST_SELECT = {
  id: true,
  jobNumber: true,
  title: true,
  status: true,
  createdAt: true,
  customer: { select: { firstName: true, lastName: true } },
  worker: { select: { firstName: true, lastName: true } },
  payments: { select: { status: true, amountCents: true, refundedCents: true } },
  problems: { where: { status: "OPEN" }, select: { topic: true, urgent: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  statusHistory: { where: { toStatus: "CANCEL_REVIEW" }, select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
} satisfies Prisma.JobSelect;

/** Every open case, oldest first. Null for anyone but the office. */
export async function loadDisputeList(db: Db, viewer: JobViewer, page = 1, now = new Date()): Promise<DisputeListData | null> {
  if (!(await isOffice(db, viewer))) return null;
  const jobs = await db.job.findMany({ where: OPEN_CASE_WHERE, select: LIST_SELECT, orderBy: { createdAt: "asc" }, take: DISPUTE_LIST_LIMIT });
  const cancelReasons = await db.auditLog.findMany({
    where: { recordType: "jobs", recordId: { in: jobs.filter((job) => job.status === "CANCEL_REVIEW").map((job) => job.id) }, action: "job.cancel_requested" },
    select: { recordId: true, reason: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const rows = jobs.map((job): DisputeRow & { sort: number } => {
    const kinds: DisputeKind[] = [];
    const starts: Date[] = [];
    let detail = "";
    if (job.status === "CANCEL_REVIEW") {
      kinds.push("cancellation");
      starts.push(job.statusHistory[0]?.createdAt ?? job.createdAt);
      detail = cancelReasons.find((entry) => entry.recordId === job.id)?.reason ?? "";
    }
    if (job.problems.length) {
      kinds.push("problem");
      starts.push(job.problems[0].createdAt);
      if (!detail) detail = job.problems.length > 1 ? `${job.problems[0].topic} (+${job.problems.length - 1} more)` : job.problems[0].topic;
    }
    const since = new Date(Math.min(...starts.map((date) => date.getTime())));
    const paid = job.payments.filter((payment) => (PAID as readonly string[]).includes(payment.status));
    return {
      jobId: job.id,
      number: jobNumber(job.jobNumber),
      title: job.title,
      kinds,
      kindLabel: disputeKindLabel(kinds, job.problems.some((problem) => problem.urgent)),
      detail: detail || "—",
      since: since.toISOString(),
      age: disputeAge(since, now),
      customer: name(job.customer) ?? "—",
      tradie: name(job.worker),
      paidCents: paid.reduce((sum, payment) => sum + payment.amountCents, 0),
      refundedCents: job.payments.reduce((sum, payment) => sum + payment.refundedCents, 0),
      href: disputeHref(job.id),
      sort: since.getTime(),
    };
  });
  rows.sort((a, b) => a.sort - b.sort || a.jobId.localeCompare(b.jobId));
  const total = rows.length;
  const current = Math.min(Math.max(1, page), Math.max(1, Math.ceil(total / DISPUTES_PAGE_SIZE)));
  const slice = rows.slice((current - 1) * DISPUTES_PAGE_SIZE, current * DISPUTES_PAGE_SIZE);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the sort key stays on the server.
  return { total, page: current, rows: slice.map(({ sort, ...row }) => row) };
}

const CASE_SELECT = {
  id: true,
  jobNumber: true,
  title: true,
  status: true,
  category: true,
  suburb: true,
  customerId: true,
  workerId: true,
  customer: { select: { id: true, firstName: true, lastName: true } },
  worker: { select: { id: true, firstName: true, lastName: true } },
  pricing: { select: { minutes: true, workerRateCents: true, holidayPayBps: true, workerGrossCents: true, holidayPayCents: true } },
  payments: { select: { id: true, kind: true, status: true, amountCents: true, refundedCents: true }, orderBy: { createdAt: "asc" } },
  variations: { where: { status: "APPROVED" }, select: { minutes: true } },
  payouts: { select: { id: true, workerId: true, status: true, minutes: true, grossCents: true, holidayPayCents: true } },
  evidence: { select: { submittedAt: true, notes: true, cocNumber: true, photos: { select: { id: true, path: true }, orderBy: { position: "asc" } } } },
  problems: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      topic: true,
      details: true,
      urgent: true,
      status: true,
      reportedById: true,
      createdAt: true,
      resolution: true,
      resolvedAt: true,
      reportedBy: { select: { firstName: true, lastName: true } },
      resolvedBy: { select: { firstName: true, lastName: true } },
      photos: { select: { id: true, path: true }, orderBy: [{ position: "asc" }, { id: "asc" }] },
      supportThread: { select: { id: true } },
    },
  },
  statusHistory: { where: { toStatus: "CANCEL_REVIEW" }, select: { fromStatus: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
} satisfies Prisma.JobSelect;

/**
 * One case in full: both sides, the money and what was decided. Null when there's no such job, or the viewer isn't
 * the office. A job that never had a case still opens (it reads as resolved) so links never break.
 */
export async function loadDisputeCase(
  db: Db,
  viewer: JobViewer,
  jobId: string,
  now = new Date(),
  signPhoto = (path: string) => createSupabaseFileStore().signedUrl(PHOTO_BUCKET, path, SIGNED_URL_SECONDS),
): Promise<DisputeCaseView | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId) || !(await isOffice(db, viewer))) return null;
  const job = await db.job.findUnique({ where: { id: jobId }, select: CASE_SELECT });
  if (!job) return null;

  const audit = await db.auditLog.findMany({
    where: {
      OR: [
        { recordType: "jobs", recordId: job.id, action: { in: ["job.cancel_requested", ...DECISION_ACTIONS] } },
        ...(job.workerId ? [{ recordType: "jobs", recordId: job.id, actorId: job.workerId, action: { in: [...TRADIE_UPDATE_ACTIONS] } }] : []),
      ],
    },
    select: { id: true, actorId: true, action: true, reason: true, before: true, after: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const actorIds = [...new Set(audit.map((row) => row.actorId).filter((id): id is string => Boolean(id)))];
  const people = actorIds.length ? await db.profile.findMany({ where: { id: { in: actorIds } }, select: { id: true, firstName: true, lastName: true } }) : [];
  const names = new Map(people.map((person) => [person.id, fullName(person)]));

  let filesUnavailable = false;
  const sign = async (photo: { id: string; path: string }) => {
    try {
      return { id: photo.id, url: await signPhoto(photo.path) };
    } catch {
      filesUnavailable = true;
      return { id: photo.id, url: null };
    }
  };

  // The customer's side: why they asked to cancel (the latest request), and every problem report on the job.
  const request = audit.find((row) => row.action === "job.cancel_requested");
  const entered = job.statusHistory[0];
  const askedAt = request?.createdAt ?? entered?.createdAt ?? now;
  const cancellation =
    request || job.status === "CANCEL_REVIEW"
      ? {
          open: job.status === "CANCEL_REVIEW",
          reason: request?.reason ?? null,
          by: request?.actorId ? ("customer" as const) : ("system" as const),
          byName: request?.actorId ? (names.get(request.actorId) ?? null) : null,
          at: askedAt.toISOString(),
          when: whenLabel(askedAt, now),
          backTo: reinstateTarget(entered?.fromStatus ?? null, job.workerId),
        }
      : null;

  const problems: DisputeProblem[] = await Promise.all(
    job.problems.map(async (report) => ({
      id: report.id,
      topic: report.topic,
      details: report.details,
      urgent: report.urgent,
      status: report.status,
      reporter: report.reportedById === job.workerId ? ("tradie" as const) : ("customer" as const),
      reporterName: fullName(report.reportedBy),
      at: report.createdAt.toISOString(),
      when: whenLabel(report.createdAt, now),
      photos: await Promise.all(report.photos.map(sign)),
      threadHref: report.supportThread ? `/admin/support/${encodeURIComponent(report.supportThread.id)}` : null,
      resolution: report.resolution,
      resolvedBy: name(report.resolvedBy),
      resolvedWhen: report.resolvedAt ? whenLabel(report.resolvedAt, now) : null,
    })),
  );
  problems.sort((a, b) => Number(b.status === "OPEN") - Number(a.status === "OPEN"));

  // The tradie's side: what they did on the job, newest first, and the evidence they sent.
  const updates: DisputeUpdate[] = audit
    .filter((row) => (TRADIE_UPDATE_ACTIONS as readonly string[]).includes(row.action))
    .slice(0, 30)
    .map((row) => ({
      id: row.id,
      title: timelineTitle({ action: row.action, before: asRecord(row.before), after: asRecord(row.after), names }),
      detail: row.reason,
      at: row.createdAt.toISOString(),
      when: whenLabel(row.createdAt, now),
    }));
  const evidence = job.evidence
    ? {
        sentAt: job.evidence.submittedAt?.toISOString() ?? null,
        sentWhen: job.evidence.submittedAt ? whenLabel(job.evidence.submittedAt, now) : null,
        notes: job.evidence.notes,
        cocNumber: job.evidence.cocNumber,
        photos: await Promise.all(job.evidence.photos.map(sign)),
      }
    : null;

  // The money: what was paid and given back, and the tradie's payout.
  const paid = job.payments.filter((payment) => (PAID as readonly string[]).includes(payment.status));
  const payments: DisputePayment[] = paid.map((payment) => ({
    id: payment.id,
    label: PAYMENT_LABELS[payment.kind],
    amountCents: payment.amountCents,
    refundedCents: payment.refundedCents,
    refundableCents: (REFUNDABLE as readonly string[]).includes(payment.status) ? Math.max(0, payment.amountCents - payment.refundedCents) : 0,
  }));
  const payout = job.payouts.find((row) => row.workerId === job.workerId) ?? null;
  const extraMinutes = job.variations.reduce((sum, variation) => sum + (variation.minutes ?? 0), 0);

  const decisions: DisputeDecisionEntry[] = [
    ...audit
      .filter((row) => (DECISION_ACTIONS as readonly string[]).includes(row.action))
      .map((row) => ({
        id: row.id,
        title: decisionTitle(row.action, asRecord(row.after)),
        note: row.reason,
        by: row.actorId ? (names.get(row.actorId) ?? null) : null,
        at: row.createdAt.toISOString(),
        when: whenLabel(row.createdAt, now),
      })),
    ...job.problems
      .filter((report) => report.status === "RESOLVED")
      .map((report) => ({
        id: `problem-${report.id}`,
        title: `Problem resolved: ${report.topic}`,
        note: report.resolution,
        by: name(report.resolvedBy),
        at: (report.resolvedAt ?? report.createdAt).toISOString(),
        when: whenLabel(report.resolvedAt ?? report.createdAt, now),
      })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return {
    id: job.id,
    number: jobNumber(job.jobNumber),
    title: job.title,
    status: job.status,
    trade: TRADE_LABELS[job.category],
    suburb: job.suburb,
    customer: { id: job.customer.id, name: fullName(job.customer) },
    tradie: job.worker ? { id: job.worker.id, name: fullName(job.worker) } : null,
    cancellation,
    problems,
    tradieSide: { updates, evidence },
    money: {
      paidCents: paid.reduce((sum, payment) => sum + payment.amountCents, 0),
      refundedCents: job.payments.reduce((sum, payment) => sum + payment.refundedCents, 0),
      payments,
      payroll: payrollState(payout?.status ?? null, job.status),
      payoutCents: payout ? payout.grossCents + payout.holidayPayCents : null,
      payoutMinutes: payout?.minutes ?? null,
      tradieEarnsCents: job.pricing ? job.pricing.workerGrossCents + job.pricing.holidayPayCents : null,
      rateCents: job.pricing?.workerRateCents ?? null,
      maxPartMinutes: job.pricing && job.workerId && !payout ? job.pricing.minutes + extraMinutes : 0,
    },
    hasPayout: Boolean(payout),
    decisions,
    messagesHref: `${OFFICE_JOB_PATH}/${encodeURIComponent(job.id)}#job-messages`,
    jobHref: `${OFFICE_JOB_PATH}/${encodeURIComponent(job.id)}`,
    filesUnavailable,
  };
}

/** Where "Keep the job going" takes it: the status before the request (the status machine's own rule). */
function reinstateTarget(before: JobStatus | null, workerId: string | null): JobStatus {
  return before && before !== "CANCEL_REVIEW" ? before : workerId ? "ASSIGNED" : "BOOKABLE";
}

function decisionTitle(action: string, after: Record<string, unknown> | null): string {
  if (action === "job.cancel_approved") {
    const refund = after?.refund === "full" ? " and refunded" : after?.refund === "partial" ? " with a part refund" : ", no refund";
    const part = typeof after?.partPayoutMinutes === "number" && after.partPayoutMinutes > 0;
    return `Cancelled${refund}${part ? " · tradie paid for part" : ""}`;
  }
  return DECISION_TITLES[action] ?? action;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
