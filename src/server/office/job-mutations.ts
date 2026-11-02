// What the office can change from the job admin view (#171): re-price, reassign, force a status, cancel, refund,
// and message both sides. Each runs in one database transaction that locks the job's row first (so two people
// acting at once can't both win), changes it through the same rules as everything else (the status machine,
// #93; the pricing module, #94), and writes the audit entry with the office's required note in the same
// transaction (#100), so the timeline can never disagree with the data.
import "server-only";

import { randomUUID } from "node:crypto";

import type { JobStatus, Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  ACTION_MESSAGES,
  forceStatusOptions,
  type JobActionInput,
  type JobActionResult,
  money,
  parseJobAction,
} from "@/lib/office-job";
import { createAudit } from "@/server/audit/audit";
import {
  applyTransition,
  JobNotFoundError,
  JobTransitionConflictError,
  JobTransitionError,
  type StatusMachineDeps,
  type Tx,
} from "@/server/jobs/status-machine";
import { createNotify } from "@/server/notifications/notify";
import { PRICEABLE_STATUSES, priceJob } from "@/server/pricing/price-job";

type Db = Pick<PrismaClient, "$transaction">;
type Office = { userId: string };

const REASSIGNABLE: readonly JobStatus[] = ["ASSIGNED", "SUBMITTED", "CANCEL_REVIEW"];
const CLOSED: readonly JobStatus[] = ["COMPLETED", "CANCELLED"];

const fail = (error: Exclude<JobActionResult, { ok: true }>["error"], message: string, field?: string): JobActionResult => ({
  ok: false,
  error,
  message,
  ...(field ? { field } : {}),
});
const notAllowed = (message: string) => fail("not-allowed", message);

/** The job as the actions see it, read after its row is locked. */
type LockedJob = Prisma.JobGetPayload<{
  select: { id: true; jobNumber: true; status: true; workerId: true; customerId: true; category: true; priceCents: true };
}>;

/** Thrown inside the transaction to roll it back and answer with a plain result. */
class Refusal extends Error {
  constructor(readonly result: JobActionResult) {
    super("refused");
  }
}

/** Checks, then does, one office action. Never throws for a refusal: it answers with what to tell the office. */
export async function performJobAction(db: Db, office: Office, raw: unknown): Promise<JobActionResult> {
  const parsed = parseJobAction(raw);
  if (!parsed.ok) return fail("invalid", parsed.message, parsed.field);
  try {
    await db.$transaction((tx) => run(tx, office, parsed.input));
    return { ok: true };
  } catch (error) {
    if (error instanceof Refusal) return error.result;
    if (error instanceof JobNotFoundError) return fail("not-found", ACTION_MESSAGES.notFound);
    if (error instanceof JobTransitionConflictError) return fail("changed", ACTION_MESSAGES.changed);
    if (error instanceof JobTransitionError) return notAllowed("The rules don’t allow that for this job right now.");
    // A database rule (e.g. a job can’t be ASSIGNED with nobody on it) or a lost connection. Details stay in the log.
    console.error("Job admin: an office action failed and was rolled back.", error);
    return fail("unavailable", ACTION_MESSAGES.unavailable);
  }
}

async function run(tx: Tx, office: Office, input: JobActionInput): Promise<void> {
  // Who is acting, for the status history and the audit log's default. Local to this transaction.
  await tx.$queryRaw`SELECT set_config('app.actor_id', ${office.userId}, true)`;
  // Lock the job's row so a customer cancelling or a tradie claiming at the same moment waits for us, and what we
  // read next is what we act on. A write is the lock Prisma gives us without naming the table; it is rolled back
  // with everything else when the action is refused.
  const locked = await tx.job.updateMany({ where: { id: input.jobId }, data: { updatedAt: new Date() } });
  if (locked.count !== 1) throw new Refusal(fail("not-found", ACTION_MESSAGES.notFound));
  const job = await tx.job.findUnique({
    where: { id: input.jobId },
    select: { id: true, jobNumber: true, status: true, workerId: true, customerId: true, category: true, priceCents: true },
  });
  if (!job) throw new Refusal(fail("not-found", ACTION_MESSAGES.notFound));

  if (input.action === "message") return sendMessage(tx, office, job, input.body);
  if (job.status !== input.seenStatus) throw new Refusal(fail("changed", ACTION_MESSAGES.changed));

  switch (input.action) {
    case "price":
      return reprice(tx, office, job, input);
    case "reassign":
      return reassign(tx, office, job, input);
    case "status":
      return forceStatus(tx, office, job, input);
    case "cancel":
      return cancel(tx, office, job, input);
    case "refund":
      return refund(tx, office, job, input);
  }
}

// ---------------------------------------------------------------- Edit price

async function reprice(tx: Tx, office: Office, job: LockedJob, input: Extract<JobActionInput, { action: "price" }>) {
  if (!PRICEABLE_STATUSES.includes(job.status)) {
    throw new Refusal(notAllowed("This job has been paid for, so its price can’t change. Refund part of it instead."));
  }
  // priceJob opens its own transaction; handing it this one keeps the price, its pricing row and the audit entry together.
  const inThisTransaction = { $transaction: (work: (tx: Tx) => unknown) => work(tx) } as unknown as Parameters<typeof priceJob>[0];
  const result = await priceJob(inThisTransaction, {
    jobId: job.id,
    minutes: input.minutes,
    materialsCents: input.materialsCents,
    note: input.note,
    pricedById: office.userId,
  });
  if (!result.ok) {
    throw new Refusal(result.error === "job-not-found" ? fail("not-found", ACTION_MESSAGES.notFound) : notAllowed("This job can’t be priced any more."));
  }
  await createAudit(tx)(
    office,
    "job.priced",
    { type: "jobs", id: job.id },
    { priceCents: job.priceCents },
    { priceCents: result.breakdown.customerPriceCents },
    input.note,
  );
}

// ---------------------------------------------------------------- Status changes through the machine

/** The status machine's after-effects for an office action: one audit entry under the action's own name, and the notification. */
function deps(
  tx: Tx,
  office: Office,
  audit: "job.reassigned" | "job.cancelled" | "job.status_overridden",
): StatusMachineDeps {
  return {
    audit: async (_tx, entry) => {
      await createAudit(tx)(office, audit, { type: "jobs", id: entry.recordId }, entry.before, entry.after, entry.reason ?? "");
    },
    notify: async (_tx, change) => {
      const people = [change.customerId, change.workerBefore, change.workerAfter].filter((id): id is string => Boolean(id) && id !== office.userId);
      const event = audit === "job.cancelled" ? "job.cancelled" : "job.status_overridden";
      await createNotify(tx)(event, [...new Set(people)], {
        eventId: `office-${audit}-${change.jobId}-${randomUUID()}`,
        payload: { jobId: change.jobId, jobNumber: change.jobNumber },
      });
    },
  };
}

async function reassign(tx: Tx, office: Office, job: LockedJob, input: Extract<JobActionInput, { action: "reassign" }>) {
  if (!REASSIGNABLE.includes(job.status) || !job.workerId) throw new Refusal(notAllowed("There’s no tradie on this job to swap."));
  if (input.workerId === job.workerId) throw new Refusal(fail("invalid", "That tradie already has the job.", "workerId"));
  if (input.workerId === job.customerId) throw new Refusal(fail("invalid", "Pick a tradie.", "workerId"));
  const tradie = await tx.profile.findUnique({ where: { id: input.workerId }, select: { role: true } });
  if (tradie?.role !== "TRADIE") throw new Refusal(fail("invalid", "Pick a tradie.", "workerId"));
  if (job.category !== "OTHER") {
    const today = new Date();
    const licensed = await tx.licence.count({
      where: {
        userId: input.workerId,
        trade: job.category,
        status: "VERIFIED",
        OR: [{ expiresOn: null }, { expiresOn: { gte: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) } }],
      },
    });
    if (licensed === 0) throw new Refusal(fail("invalid", "That tradie isn’t verified for this trade.", "workerId"));
  }
  await applyTransition(tx, deps(tx, office, "job.reassigned"), {
    jobId: job.id,
    transition: "override",
    actor: { role: "ADMIN", userId: office.userId },
    reason: input.note,
    to: job.status,
    workerId: input.workerId,
  });
}

async function forceStatus(tx: Tx, office: Office, job: LockedJob, input: Extract<JobActionInput, { action: "status" }>) {
  const allowed = forceStatusOptions({
    status: job.status,
    tradie: job.workerId ? { id: job.workerId, name: "" } : null,
    priceCents: job.priceCents,
  });
  if (!allowed.some((option) => option.value === input.to)) {
    throw new Refusal(fail("invalid", "The job can’t be moved to that status. It needs a tradie or a price first.", "to"));
  }
  await applyTransition(tx, deps(tx, office, "job.status_overridden"), {
    jobId: job.id,
    transition: "override",
    actor: { role: "ADMIN", userId: office.userId },
    reason: input.note,
    to: input.to,
  });
}

async function cancel(tx: Tx, office: Office, job: LockedJob, input: Extract<JobActionInput, { action: "cancel" }>) {
  if (CLOSED.includes(job.status)) throw new Refusal(notAllowed("This job is already closed."));
  await applyTransition(tx, deps(tx, office, "job.cancelled"), {
    jobId: job.id,
    transition: "override",
    actor: { role: "ADMIN", userId: office.userId },
    reason: input.note,
    to: "CANCELLED",
  });
}

// ---------------------------------------------------------------- Refund

/**
 * Records a refund against one payment: the payment's `refundedCents` and status move, with the office's note on
 * the audit entry. It is a record only: payments are in test mode, and nothing is sent to Stripe (DECISIONS.md 7).
 */
async function refund(tx: Tx, office: Office, job: LockedJob, input: Extract<JobActionInput, { action: "refund" }>) {
  const payment = await tx.payment.findFirst({ where: { id: input.paymentId, jobId: job.id } });
  if (!payment) throw new Refusal(fail("invalid", "Pick a payment.", "paymentId"));
  if (payment.status !== "PAID" && payment.status !== "PARTIALLY_REFUNDED") {
    throw new Refusal(notAllowed("That payment has nothing left to refund."));
  }
  const left = payment.amountCents - payment.refundedCents;
  const giving = input.mode === "full" ? left : (input.amountCents ?? 0);
  if (giving < 1) throw new Refusal(notAllowed("That payment has nothing left to refund."));
  if (giving > left) throw new Refusal(fail("invalid", `You can refund up to ${money(left)} of this payment.`, "amount"));

  const refundedCents = payment.refundedCents + giving;
  const status = refundedCents === payment.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED";
  // Only while nobody else has refunded it since we read it (the row is locked by the update).
  const updated = await tx.payment.updateMany({
    where: { id: payment.id, refundedCents: payment.refundedCents, status: payment.status },
    data: { refundedCents, status, refundedAt: new Date() },
  });
  if (updated.count !== 1) throw new Refusal(fail("changed", ACTION_MESSAGES.changed));
  await createAudit(tx)(
    office,
    status === "REFUNDED" ? "payment.refunded" : "payment.partially_refunded",
    { type: "payments", id: payment.id },
    { status: payment.status, refundedCents: payment.refundedCents },
    { status, refundedCents },
    input.note,
  );
}

// ---------------------------------------------------------------- Message both

/**
 * One message from the office to the customer and, when there is one, the tradie. Each person has one open
 * support thread about the job (made on the first message), so it lands in the same place their other messages
 * to the office do.
 */
async function sendMessage(tx: Tx, office: Office, job: LockedJob, body: string) {
  for (const userId of [job.customerId, job.workerId]) {
    if (!userId) continue;
    const open = await tx.supportThread.findFirst({ where: { userId, jobId: job.id, status: "OPEN" }, select: { id: true } });
    const threadId =
      open?.id ??
      (await tx.supportThread.create({ data: { userId, jobId: job.id, subject: `TM-${job.jobNumber}` }, select: { id: true } })).id;
    await tx.supportMessage.create({ data: { threadId, authorId: office.userId, body } });
  }
}
