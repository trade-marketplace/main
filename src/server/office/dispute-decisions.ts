// The office's decisions on a case (#172, F06). Money first, then the job:
//
//  1. Check: in a short read, that the case is still open and the decision can be made as asked (what's left to
//     refund, the part payout's limit). Nothing has changed yet, so a refusal here changes nothing.
//  2. Refund: through refundPayment (src/server/payments/refunds.ts, #157), one payment at a time. Each refund has
//     its own request id made from the dialog's (so trying the same decision again sends Stripe the same key and is
//     never refunded twice), and a refund this decision already recorded is skipped. If Stripe doesn't make one,
//     stop: the job and the report stay exactly as they were, and the office is told.
//  3. Decide: in one transaction under the job's row lock, change the job through the status machine (#93:
//     approve-cancel or reinstate) or resolve the report, queue a part payout if one was asked for, write the audit
//     entries with the office's note, and tell the customer and the tradie (in-app). If that fails, the refund
//     stays recorded and the office tries again: step 2 then skips it.
import "server-only";

import { createHash } from "node:crypto";

import type { JobStatus, Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  DECISION_DONE,
  DISPUTE_MESSAGES,
  type DisputeDecisionInput,
  type DisputeResult,
  parseDisputeDecision,
} from "@/lib/office-disputes";
import { type JobActionError, money } from "@/lib/office-job";
import { createAudit } from "@/server/audit/audit";
import { applyTransition, JobTransitionConflictError, JobTransitionError, type StatusMachineDeps } from "@/server/jobs/status-machine";
import { lockJobWindows } from "@/server/jobs/window-lock";
import { createNotify } from "@/server/notifications/notify";
import { refundPayment, type RefundsApi } from "@/server/payments/refunds";
import { partPayoutLimit, queuePartPayout } from "@/server/payouts/part-payout";

type Db = Pick<PrismaClient, "$transaction">;
type Tx = Prisma.TransactionClient;
type Office = { userId: string };
type CancellationInput = Extract<DisputeDecisionInput, { kind: "cancellation" }>;
type ProblemInput = Extract<DisputeDecisionInput, { kind: "problem" }>;

const REFUNDABLE: readonly string[] = ["PAID", "PARTIALLY_REFUNDED"];
const PAID: readonly string[] = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"];

const fail = (error: JobActionError, message: string, field?: string): DisputeResult => ({ ok: false, error, message, ...(field ? { field } : {}) });

/** Thrown inside a transaction to roll it back and answer with a plain result. */
class Refusal extends Error {
  constructor(readonly result: DisputeResult) {
    super("refused");
  }
}

/** One refund in a decision. "full" gives back what's left on the payment. */
type RefundStep = { paymentId: string; mode: "full" | "partial"; amountCents: number | null; requestId: string; recorded: boolean };
type Plan = { done: string | null; seenStatus: JobStatus; refunds: RefundStep[] };

/**
 * The refund request id for one payment in one decision: the same for every try of the same dialog, different for
 * each payment (a uuid made from both, like notification ids).
 */
export function refundRequestId(decisionId: string, paymentId: string): string {
  const bytes = createHash("sha256").update(`dispute-refund:${decisionId}:${paymentId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Decides one case. Never throws: it answers with what to tell the office. */
export async function decideDispute(db: Db, office: Office, raw: unknown, refunds: RefundsApi | null, now = new Date()): Promise<DisputeResult> {
  const parsed = parseDisputeDecision(raw);
  if (!parsed.ok) return fail("invalid", parsed.message, parsed.field);
  const input = parsed.input;
  const done = DECISION_DONE[input.kind === "problem" ? "resolve" : input.decision];

  let plan: Plan;
  try {
    plan = await db.$transaction((tx) => (input.kind === "cancellation" ? planCancellation(tx, office, input) : planProblem(tx, office, input)), { timeout: 30_000 });
  } catch (error) {
    if (error instanceof Refusal) return error.result;
    console.error("Disputes: couldn't check a decision.", error);
    return fail("unavailable", DISPUTE_MESSAGES.unavailable);
  }
  // Already decided by this same dialog (the answer to an earlier try was lost): nothing more to do.
  if (plan.done) return { ok: true, message: plan.done };

  // 2. The money, before anything about the job changes.
  let refunded = false;
  for (const step of plan.refunds) {
    if (step.recorded) {
      refunded = true;
      continue;
    }
    const result = await refundPayment(
      db,
      office,
      { action: "refund", jobId: input.jobId, seenStatus: plan.seenStatus, paymentId: step.paymentId, mode: step.mode, amountCents: step.amountCents, note: input.note, requestId: step.requestId },
      refunds,
      now,
    );
    if (!result.ok) {
      if (!refunded) return result;
      return fail(result.error, DISPUTE_MESSAGES.partlyRefunded);
    }
    refunded = true;
  }

  // 3. The decision.
  try {
    await db.$transaction((tx) => (input.kind === "cancellation" ? commitCancellation(tx, office, input) : commitProblem(tx, office, input)), { timeout: 30_000 });
  } catch (error) {
    if (error instanceof Refusal) {
      return refunded && !error.result.ok && error.result.error === "changed" ? fail("changed", DISPUTE_MESSAGES.refundedButChanged) : error.result;
    }
    if (error instanceof JobTransitionConflictError) return fail("changed", refunded ? DISPUTE_MESSAGES.refundedButChanged : DISPUTE_MESSAGES.changed);
    if (error instanceof JobTransitionError) return fail("not-allowed", "The rules don’t allow that for this job right now.");
    console.error("Disputes: a decision failed and was rolled back.", error);
    return fail("unavailable", refunded ? DISPUTE_MESSAGES.refundedNotSaved : DISPUTE_MESSAGES.unavailable);
  }
  return { ok: true, message: done };
}

// ---------------------------------------------------------------- Checking (reads only)

async function requireOffice(tx: Tx, office: Office) {
  const person = await tx.profile.findUnique({ where: { id: office.userId }, select: { role: true } });
  if (person?.role !== "ADMIN") throw new Refusal(fail("not-allowed", "You’re not able to do that. Log in again, or ask for office access."));
}

type PaymentRow = { id: string; status: string; amountCents: number; refundedCents: number };

/** True when the refund for this payment and request id was already made and recorded (by refundPayment). */
export async function refundRecorded(tx: Tx, paymentId: string, requestId: string): Promise<boolean> {
  const requests = await tx.auditLog.findMany({
    where: { action: "payment.refund_requested", recordType: "payments", recordId: paymentId, after: { path: ["requestId"], equals: requestId } },
    select: { id: true },
  });
  if (!requests.length) return false;
  const ids = new Set(requests.map((entry) => entry.id));
  const answers = await tx.auditLog.findMany({
    where: { recordType: "payments", recordId: paymentId, action: { in: ["payment.refunded", "payment.partially_refunded", "payment.refund_confirmed"] } },
    select: { after: true },
  });
  return answers.some(({ after }) => {
    const data = (after ?? {}) as Record<string, unknown>;
    return [data.refundRequestId, data.requestEntryId].some((id) => typeof id === "string" && ids.has(id));
  });
}

/** The one payment a part refund comes from, checked against what's left on it. */
async function partialStep(tx: Tx, payments: PaymentRow[], refund: { paymentId: string; amountCents: number }, decisionId: string): Promise<RefundStep> {
  const payment = payments.find((row) => row.id === refund.paymentId && PAID.includes(row.status));
  if (!payment) throw new Refusal(fail("invalid", DISPUTE_MESSAGES.payment, "paymentId"));
  const requestId = refundRequestId(decisionId, payment.id);
  const recorded = await refundRecorded(tx, payment.id, requestId);
  if (!recorded) {
    const left = REFUNDABLE.includes(payment.status) ? payment.amountCents - payment.refundedCents : 0;
    if (left < 1) throw new Refusal(fail("not-allowed", "That payment has nothing left to refund."));
    if (refund.amountCents > left) throw new Refusal(fail("invalid", `You can refund up to ${money(left)} of this payment.`, "amount"));
  }
  return { paymentId: payment.id, mode: "partial", amountCents: refund.amountCents, requestId, recorded };
}

const hoursText = (minutes: number) => `${Math.round((minutes / 60) * 100) / 100}`;

async function planCancellation(tx: Tx, office: Office, input: CancellationInput): Promise<Plan> {
  await requireOffice(tx, office);
  const job = await tx.job.findUnique({
    where: { id: input.jobId },
    select: { id: true, status: true, payments: { select: { id: true, status: true, amountCents: true, refundedCents: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!job) throw new Refusal(fail("not-found", DISPUTE_MESSAGES.notFound));
  if (job.status !== "CANCEL_REVIEW") {
    if (await cancellationDecidedBy(tx, job.id, input.requestId)) return { done: DECISION_DONE[input.decision], seenStatus: job.status, refunds: [] };
    throw new Refusal(fail("changed", DISPUTE_MESSAGES.changed));
  }

  const steps: RefundStep[] = [];
  if (input.decision === "refund" && input.refund?.mode === "partial") {
    steps.push(await partialStep(tx, job.payments, input.refund, input.requestId));
  } else if (input.decision === "refund") {
    // A full refund: everything left on every payment (the job, extra work, a quick look).
    for (const payment of job.payments.filter((row) => PAID.includes(row.status))) {
      const requestId = refundRequestId(input.requestId, payment.id);
      const recorded = await refundRecorded(tx, payment.id, requestId);
      const left = REFUNDABLE.includes(payment.status) ? payment.amountCents - payment.refundedCents : 0;
      if (recorded || left > 0) steps.push({ paymentId: payment.id, mode: "full", amountCents: null, requestId, recorded });
    }
    if (!steps.length) throw new Refusal(fail("not-allowed", DISPUTE_MESSAGES.nothingToRefund));
  }

  if (input.partPayoutMinutes !== null) {
    const limit = await partPayoutLimit(tx, job.id);
    if (!limit.ok) throw new Refusal(partPayoutRefusal(limit.reason));
    if (input.partPayoutMinutes > limit.maxMinutes) {
      throw new Refusal(fail("invalid", `Up to ${hoursText(limit.maxMinutes)} hours: the time this job was priced for, plus approved extra work.`, "hours"));
    }
  }
  return { done: null, seenStatus: job.status, refunds: steps };
}

function partPayoutRefusal(reason: "no-worker" | "not-priced" | "already-queued" | "too-long"): DisputeResult {
  if (reason === "no-worker") return fail("not-allowed", DISPUTE_MESSAGES.noTradie);
  if (reason === "not-priced") return fail("not-allowed", DISPUTE_MESSAGES.notPriced);
  if (reason === "already-queued") return fail("not-allowed", DISPUTE_MESSAGES.hasPayout);
  return fail("invalid", DISPUTE_MESSAGES.hours, "hours");
}

async function planProblem(tx: Tx, office: Office, input: ProblemInput): Promise<Plan> {
  await requireOffice(tx, office);
  const report = await tx.problemReport.findFirst({
    where: { id: input.reportId, jobId: input.jobId },
    select: { status: true, job: { select: { status: true, payments: { select: { id: true, status: true, amountCents: true, refundedCents: true } } } } },
  });
  if (!report) throw new Refusal(fail("not-found", DISPUTE_MESSAGES.notFound));
  if (report.status !== "OPEN") {
    if (await problemResolvedBy(tx, input.reportId, input.requestId)) return { done: DECISION_DONE.resolve, seenStatus: report.job.status, refunds: [] };
    throw new Refusal(fail("changed", DISPUTE_MESSAGES.changed));
  }
  if (report.job.status !== input.seenStatus) throw new Refusal(fail("changed", DISPUTE_MESSAGES.changed));
  const steps = input.refund ? [await partialStep(tx, report.job.payments, input.refund, input.requestId)] : [];
  return { done: null, seenStatus: input.seenStatus, refunds: steps };
}

async function cancellationDecidedBy(tx: Tx, jobId: string, requestId: string) {
  const count = await tx.auditLog.count({
    where: { recordType: "jobs", recordId: jobId, action: { in: ["job.cancel_approved", "job.reinstated"] }, after: { path: ["decisionId"], equals: requestId } },
  });
  return count > 0;
}

async function problemResolvedBy(tx: Tx, reportId: string, requestId: string) {
  const count = await tx.auditLog.count({
    where: { recordType: "problem_reports", recordId: reportId, action: "problem_report.resolved", after: { path: ["decisionId"], equals: requestId } },
  });
  return count > 0;
}

// ---------------------------------------------------------------- Deciding (one transaction each)

/** Says who is acting (for the status history) and takes the job's row lock, the same one reporting a problem takes. */
async function lockCase(tx: Tx, office: Office, jobId: string) {
  await tx.$queryRaw`SELECT set_config('app.actor_id', ${office.userId}, true)`;
  if (!(await lockJobWindows(tx, jobId))) throw new Refusal(fail("not-found", DISPUTE_MESSAGES.notFound));
  return tx.job.findUniqueOrThrow({ where: { id: jobId }, select: { id: true, jobNumber: true, status: true, customerId: true, workerId: true } });
}

async function commitCancellation(tx: Tx, office: Office, input: CancellationInput): Promise<void> {
  await requireOffice(tx, office);
  const job = await lockCase(tx, office, input.jobId);
  if (job.status !== "CANCEL_REVIEW") {
    if (await cancellationDecidedBy(tx, job.id, input.requestId)) return;
    throw new Refusal(fail("changed", DISPUTE_MESSAGES.changed));
  }
  const keep = input.decision === "keep";
  let auditId = "";
  const deps: StatusMachineDeps = {
    audit: async (_tx, entry) => {
      const after = {
        ...entry.after,
        decisionId: input.requestId,
        ...(keep ? {} : { refund: input.refund?.mode ?? "none", partPayoutMinutes: input.partPayoutMinutes }),
      };
      const row = await createAudit(tx)(office, keep ? "job.reinstated" : "job.cancel_approved", { type: "jobs", id: entry.recordId }, entry.before, after, input.note);
      auditId = row.id;
    },
    notify: async (_tx, change) => {
      const people = [change.customerId, change.workerBefore].filter((id): id is string => Boolean(id) && id !== office.userId);
      await createNotify(tx)(keep ? "job.reinstated" : "job.cancelled", [...new Set(people)], {
        eventId: `dispute.${input.decision}:${auditId}`,
        payload: { jobId: change.jobId, jobNumber: change.jobNumber },
      });
    },
  };
  await applyTransition(tx, deps, {
    jobId: job.id,
    transition: keep ? "reinstate" : "approve-cancel",
    actor: { role: "ADMIN", userId: office.userId },
    reason: input.note,
  });

  if (!keep && input.partPayoutMinutes !== null) {
    const payout = await queuePartPayout(tx, job.id, input.partPayoutMinutes);
    if (!payout.queued) throw new Refusal(partPayoutRefusal(payout.reason));
    await createAudit(tx)(
      office,
      "payout.queued",
      { type: "payouts", id: payout.payoutId },
      null,
      { jobId: job.id, workerId: payout.workerId, minutes: payout.minutes, grossCents: payout.grossCents, holidayPayCents: payout.holidayPayCents, part: true },
      input.note,
    );
    await createNotify(tx)("payout.queued", [payout.workerId], {
      eventId: `payout.queued:${payout.payoutId}`,
      payload: { jobId: job.id, jobNumber: job.jobNumber, payoutId: payout.payoutId },
    });
  }
}

async function commitProblem(tx: Tx, office: Office, input: ProblemInput): Promise<void> {
  await requireOffice(tx, office);
  const job = await lockCase(tx, office, input.jobId);
  const resolved = await tx.problemReport.updateMany({
    where: { id: input.reportId, jobId: job.id, status: "OPEN" },
    data: { status: "RESOLVED", resolution: input.note, resolvedById: office.userId },
  });
  if (resolved.count !== 1) {
    if (await problemResolvedBy(tx, input.reportId, input.requestId)) return;
    throw new Refusal(fail("changed", DISPUTE_MESSAGES.changed));
  }
  await createAudit(tx)(
    office,
    "problem_report.resolved",
    { type: "problem_reports", id: input.reportId },
    { status: "OPEN" },
    { status: "RESOLVED", resolution: input.note, jobId: job.id, decisionId: input.requestId, refundCents: input.refund?.amountCents ?? null },
    input.note,
  );
  const people = [job.customerId, job.workerId].filter((id): id is string => Boolean(id) && id !== office.userId);
  await createNotify(tx)("problem_report.resolved", [...new Set(people)], {
    eventId: `problem_report.resolved:${input.reportId}`,
    payload: { jobId: job.id, jobNumber: job.jobNumber, reportId: input.reportId },
  });
}
