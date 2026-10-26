import "server-only";

import type { JobStatus, Prisma, PrismaClient, Role, Trade } from "@/generated/prisma/client";

// The job status machine (#93): the one place a job's status changes. Each transition says which statuses it
// starts from, who may trigger it (customer / worker / office / system) and what must be true first. It runs in
// one database transaction that names the actor (`app.actor_id`, so the history trigger records who did it),
// changes the row with a conditional update (only while the job is still what was checked, so when two people
// act at once exactly one wins), then writes the audit entry and queues notifications through the injected
// functions. Anything that throws rolls the whole lot back. How it fits together: docs/server/status-machine.md.
//
// Ported from the old prototype's actions (claimJob, requestCancel, resolveCancellation, submitCoc, payTestMode,
// completeJob) and checked against DECISIONS.md, sitemap.json `job_statuses` and the Schema 1–4 triggers.

// ---------------------------------------------------------------- Who is acting

/** Someone signed in (role read from `profiles`, e.g. the Viewer from withRole), or the system itself. */
export type Actor = { role: Role; userId: string } | { role: "SYSTEM"; source: string };

/** customer / worker / office / system: who a transition is for. */
export type ActorKind = "customer" | "worker" | "office" | "system";

export function actorKind(actor: Actor): ActorKind {
  switch (actor.role) {
    case "CUSTOMER":
      return "customer";
    case "TRADIE":
      return "worker";
    case "ADMIN":
      return "office";
    case "SYSTEM":
      return "system";
  }
}

function actorId(actor: Actor): string | null {
  return actor.role === "SYSTEM" ? null : actor.userId;
}

// ---------------------------------------------------------------- The transitions

export type TransitionName =
  | "send-to-bounty"
  | "send-price"
  | "mark-paid"
  | "decline-price"
  | "cancel"
  | "claim"
  | "submit"
  | "sign-off"
  | "auto-sign-off"
  | "approve-cancel"
  | "reinstate"
  | "override";

type TransitionRule = {
  from: readonly JobStatus[] | "any";
  /** Where it goes. `null` when it depends on the job (cancel, reinstate, override). */
  to: JobStatus | null;
  by: readonly ActorKind[];
  /** Dotted audit action (audit_log.action). */
  action: string;
};

const ALL_STATUSES: readonly JobStatus[] = [
  "REVIEW",
  "QUOTE_BOUNTY",
  "PRICED",
  "BOOKABLE",
  "ASSIGNED",
  "SUBMITTED",
  "COMPLETED",
  "CANCEL_REVIEW",
  "CANCELLED",
];

/** Every allowed transition. The table in docs/server/status-machine.md mirrors this. */
export const TRANSITIONS: Readonly<Record<TransitionName, TransitionRule>> = {
  // The estimates can't settle a price: a $30 quote bounty (DECISIONS.md 2). May be replaced by #279.
  "send-to-bounty": { from: ["REVIEW"], to: "QUOTE_BOUNTY", by: ["office", "system"], action: "job.bounty_posted" },
  // The price goes to the customer. The job must already be priced (priceJob, #94).
  "send-price": { from: ["REVIEW", "QUOTE_BOUNTY"], to: "PRICED", by: ["office", "system"], action: "job.priced" },
  // The payment provider says the job is paid. Only the payment webhook (system) does this.
  "mark-paid": { from: ["PRICED"], to: "BOOKABLE", by: ["system"], action: "job.paid" },
  // "No thanks" on the price (C09). Free, unless money is held (a paid quick look): then the office reviews.
  "decline-price": { from: ["PRICED"], to: null, by: ["customer"], action: "job.price_declined" },
  // Before paying: cancelled, free. After paying: CANCEL_REVIEW, with a reason (C17).
  cancel: {
    from: ["REVIEW", "QUOTE_BOUNTY", "PRICED", "BOOKABLE", "ASSIGNED"],
    to: null,
    by: ["customer"],
    action: "job.cancelled",
  },
  claim: { from: ["BOOKABLE"], to: "ASSIGNED", by: ["worker"], action: "job.claimed" },
  // The worker sends the job for sign-off once their evidence is sent and no extra work is waiting.
  submit: { from: ["ASSIGNED"], to: "SUBMITTED", by: ["worker"], action: "job.submitted" },
  "sign-off": { from: ["SUBMITTED"], to: "COMPLETED", by: ["customer"], action: "job.signed_off" },
  // 48h (settings.auto_release_hours) after the evidence was sent, unless a problem report is open.
  "auto-sign-off": { from: ["SUBMITTED"], to: "COMPLETED", by: ["system"], action: "job.auto_signed_off" },
  // The office decides a cancellation request (F06). Refunds are the payments module's, not this.
  "approve-cancel": { from: ["CANCEL_REVIEW"], to: "CANCELLED", by: ["office"], action: "job.cancel_approved" },
  // Back to the status it was in when the cancellation was asked for.
  reinstate: { from: ["CANCEL_REVIEW"], to: null, by: ["office"], action: "job.reinstated" },
  // The office forces a status (F05). Always with a reason.
  override: { from: "any", to: null, by: ["office"], action: "job.status_overridden" },
};

/** Transitions that only go ahead with a reason. `cancel` / `decline-price` need one only when it goes to review. */
const REASON_REQUIRED: ReadonlySet<TransitionName> = new Set(["approve-cancel", "reinstate", "override"]);

/** Statuses before a worker has the job: moving back to one (by override) lets the worker go. */
const UNCLAIMED_STATUSES: readonly JobStatus[] = ["REVIEW", "QUOTE_BOUNTY", "PRICED", "BOOKABLE"];

// ---------------------------------------------------------------- Errors

export type JobTransitionErrorCode =
  | "job-not-found"
  | "illegal-transition"
  | "forbidden"
  | "precondition-failed"
  | "conflict";

export type PreconditionFailure =
  | "reason-required"
  | "not-priced"
  | "not-paid"
  | "licence-required"
  | "own-job"
  | "evidence-not-sent"
  | "extra-work-open"
  | "problem-open"
  | "sign-off-not-due"
  | "no-target"
  | "same-status";

/** Base class: every refusal from the status machine is one of these, and nothing was changed. */
export class JobTransitionError extends Error {
  constructor(
    readonly code: JobTransitionErrorCode,
    readonly jobId: string,
    readonly transition: TransitionName,
    message: string,
  ) {
    super(message);
    this.name = "JobTransitionError";
  }
}

export class JobNotFoundError extends JobTransitionError {
  constructor(jobId: string, transition: TransitionName) {
    super("job-not-found", jobId, transition, `Job ${jobId} doesn't exist.`);
    this.name = "JobNotFoundError";
  }
}

/** The transition doesn't start from the job's status (e.g. claiming a job that's already ASSIGNED). */
export class IllegalTransitionError extends JobTransitionError {
  constructor(
    jobId: string,
    transition: TransitionName,
    readonly from: JobStatus,
  ) {
    super("illegal-transition", jobId, transition, `Job ${jobId} is ${from}: "${transition}" isn't allowed.`);
    this.name = "IllegalTransitionError";
  }
}

/** Wrong kind of actor, or not their job. */
export class TransitionForbiddenError extends JobTransitionError {
  constructor(jobId: string, transition: TransitionName, why: string) {
    super("forbidden", jobId, transition, `Not allowed to "${transition}" job ${jobId}: ${why}.`);
    this.name = "TransitionForbiddenError";
  }
}

export class TransitionPreconditionError extends JobTransitionError {
  constructor(
    jobId: string,
    transition: TransitionName,
    readonly failure: PreconditionFailure,
  ) {
    super("precondition-failed", jobId, transition, `Can't "${transition}" job ${jobId}: ${failure}.`);
    this.name = "TransitionPreconditionError";
  }
}

/** The job kept changing underneath us. Rare; trying again sorts it out. */
export class JobTransitionConflictError extends JobTransitionError {
  constructor(jobId: string, transition: TransitionName) {
    super("conflict", jobId, transition, `Job ${jobId} kept changing. Try again.`);
    this.name = "JobTransitionConflictError";
  }
}

// ---------------------------------------------------------------- Deciding (pure)

/** The job as the machine sees it. */
export type JobSnapshot = {
  id: string;
  jobNumber: number;
  status: JobStatus;
  customerId: string;
  workerId: string | null;
  category: Trade;
  priceCents: number | null;
};

/** What the preconditions need from other tables. Only the facts a transition uses are loaded. */
export type JobFacts = {
  /** A `job_pricing` row exists (priced through #94). */
  hasPricing?: boolean;
  /** A JOB payment is PAID. */
  jobPaymentPaid?: boolean;
  /** Any payment (job, quick look, extra work) is PAID or PARTIALLY_REFUNDED: money is held. */
  moneyHeld?: boolean;
  /** The acting worker has a VERIFIED, unexpired licence for the job's trade. */
  workerLicensed?: boolean;
  /** When the evidence was sent (completion_evidence.submitted_at). */
  evidenceSentAt?: Date | null;
  /** Extra work waiting on the office or the customer (REQUESTED or PRICED). */
  extraWorkOpen?: boolean;
  /** An OPEN problem report: pauses the auto sign-off. */
  problemOpen?: boolean;
  autoReleaseHours?: number;
  /** The status the job was in when the cancellation was asked for. */
  statusBeforeCancelReview?: JobStatus | null;
};

export type TransitionRequest = {
  jobId: string;
  transition: TransitionName;
  actor: Actor;
  /** Required for office decisions and override, and for a cancel that goes to review. */
  reason?: string | null;
  /** Override only: where to. */
  to?: JobStatus;
  /** Override only: the worker to put on the job (reassign). Cleared automatically for statuses before claim. */
  workerId?: string | null;
  /** The clock, for the auto sign-off. Defaults to now. */
  now?: Date;
};

export type TransitionPlan = {
  from: JobStatus;
  to: JobStatus;
  /** The job's worker afterwards. */
  workerId: string | null;
  reason: string | null;
  action: string;
};

const WHO_MAY: Record<ActorKind, string> = {
  customer: "only the customer",
  worker: "only a worker",
  office: "only the office",
  system: "only the system",
};

/**
 * Decides a transition without touching the database: throws a JobTransitionError when it isn't allowed,
 * otherwise says where the job goes. `transitionJob` calls it with the job and facts it has just read.
 */
export function decideTransition(job: JobSnapshot, request: TransitionRequest, facts: JobFacts = {}): TransitionPlan {
  const { transition, actor } = request;
  const rule = TRANSITIONS[transition];
  const kind = actorKind(actor);
  const fail = (failure: PreconditionFailure) => new TransitionPreconditionError(job.id, transition, failure);

  if (!rule.by.includes(kind)) {
    throw new TransitionForbiddenError(job.id, transition, rule.by.map((by) => WHO_MAY[by]).join(" or "));
  }
  if (rule.from !== "any" && !rule.from.includes(job.status)) {
    throw new IllegalTransitionError(job.id, transition, job.status);
  }
  if (kind === "customer" && actorId(actor) !== job.customerId) {
    throw new TransitionForbiddenError(job.id, transition, "it isn't their job");
  }

  const reason = request.reason?.trim() || null;
  if (REASON_REQUIRED.has(transition) && !reason) throw fail("reason-required");

  const plan = (to: JobStatus, workerId: string | null = job.workerId): TransitionPlan => ({
    from: job.status,
    to,
    workerId,
    reason,
    action: rule.action,
  });

  switch (transition) {
    case "send-to-bounty":
      return plan("QUOTE_BOUNTY");

    case "send-price":
      if (job.priceCents === null || !facts.hasPricing) throw fail("not-priced");
      return plan("PRICED");

    case "mark-paid":
      if (!facts.jobPaymentPaid) throw fail("not-paid");
      return plan("BOOKABLE");

    case "decline-price":
    case "cancel": {
      // Paid (the job, or a quick look): the office checks before any refund. BOOKABLE and ASSIGNED are always paid.
      const paid = job.status === "BOOKABLE" || job.status === "ASSIGNED" || Boolean(facts.moneyHeld);
      if (!paid) return plan("CANCELLED");
      if (!reason) throw fail("reason-required");
      return { ...plan("CANCEL_REVIEW"), action: "job.cancel_requested" };
    }

    case "claim": {
      const workerId = actorId(actor) as string;
      if (workerId === job.customerId) throw fail("own-job");
      // DECISIONS.md 1: anyone can take Other jobs; restricted work needs a licence first.
      if (job.category !== "OTHER" && !facts.workerLicensed) throw fail("licence-required");
      return plan("ASSIGNED", workerId);
    }

    case "submit":
      if (actorId(actor) !== job.workerId) throw new TransitionForbiddenError(job.id, transition, "it isn't their job");
      if (!facts.evidenceSentAt) throw fail("evidence-not-sent");
      if (facts.extraWorkOpen) throw fail("extra-work-open");
      return plan("SUBMITTED");

    case "sign-off":
      return plan("COMPLETED");

    case "auto-sign-off": {
      if (facts.problemOpen) throw fail("problem-open");
      const sentAt = facts.evidenceSentAt;
      const hours = facts.autoReleaseHours ?? 48;
      const now = request.now ?? new Date();
      if (!sentAt || now.getTime() - sentAt.getTime() < hours * 3_600_000) throw fail("sign-off-not-due");
      return plan("COMPLETED");
    }

    case "approve-cancel":
      return plan("CANCELLED");

    case "reinstate": {
      // Back where it was. Without a history row (shouldn't happen), the worker on the job says which.
      const before = facts.statusBeforeCancelReview;
      const to = before && before !== "CANCEL_REVIEW" ? before : job.workerId ? "ASSIGNED" : "BOOKABLE";
      return plan(to);
    }

    case "override": {
      const to = request.to;
      if (!to || !ALL_STATUSES.includes(to)) throw fail("no-target");
      const workerId = UNCLAIMED_STATUSES.includes(to)
        ? null
        : request.workerId !== undefined
          ? request.workerId
          : job.workerId;
      if (to === job.status && workerId === job.workerId) throw fail("same-status");
      return plan(to, workerId);
    }
  }
}

// ---------------------------------------------------------------- After-effects (injected)

/** The transaction client the after-effects run in. */
export type Tx = Prisma.TransactionClient;

/** One status change, as handed to the audit writer and the notifier. */
export type JobStatusChange = {
  jobId: string;
  jobNumber: number;
  customerId: string;
  transition: TransitionName;
  from: JobStatus;
  to: JobStatus;
  workerBefore: string | null;
  workerAfter: string | null;
  actor: Actor;
  reason: string | null;
};

/** What the audit helper (#100) writes. Shaped like an `audit_log` row. */
export type JobAuditEntry = {
  actorId: string | null;
  action: string;
  recordType: "jobs";
  recordId: string;
  before: { status: JobStatus; workerId: string | null };
  after: { status: JobStatus; workerId: string | null };
  reason: string | null;
};

export type StatusMachineDeps = {
  /** Writes the audit_log row, in the same transaction (#100). */
  audit: (tx: Tx, entry: JobAuditEntry) => Promise<void>;
  /** Queues the notifications for this change, in the same transaction (#98). */
  notify: (tx: Tx, change: JobStatusChange) => Promise<void>;
};

// ---------------------------------------------------------------- Running it

const JOB_SELECT = {
  id: true,
  jobNumber: true,
  status: true,
  customerId: true,
  workerId: true,
  category: true,
  priceCents: true,
} as const;

/** Tries to read-check-write this many times when someone else keeps changing the job first. */
const MAX_ATTEMPTS = 5;

type Db = Pick<PrismaClient, "$transaction">;

/** Runs one transition in its own database transaction. */
export async function transitionJob(
  db: Db,
  deps: StatusMachineDeps,
  request: TransitionRequest,
): Promise<JobStatusChange> {
  return db.$transaction((tx) => applyTransition(tx, deps, request));
}

/**
 * The same, inside a transaction the caller already has (e.g. sending evidence and submitting together).
 * Throws a JobTransitionError when it isn't allowed; the caller's transaction then rolls back.
 */
export async function applyTransition(
  tx: Tx,
  deps: StatusMachineDeps,
  request: TransitionRequest,
): Promise<JobStatusChange> {
  // Who is acting, for the history trigger and the audit log's default. Local to this transaction.
  await tx.$queryRaw`SELECT set_config('app.actor_id', ${actorId(request.actor) ?? ""}, true)`;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const job = await tx.job.findUnique({ where: { id: request.jobId }, select: JOB_SELECT });
    if (!job) throw new JobNotFoundError(request.jobId, request.transition);

    const plan = decideTransition(job, request, await loadFacts(tx, job, request));

    // Only while the job is still exactly what was checked. Postgres re-checks the WHERE after waiting for a
    // row lock held by someone else, so of two people acting at once only one matches; the other goes round
    // again and is decided against what the winner left (a second claim is then illegal; a cancel that lost
    // to a claim becomes a request to cancel the ASSIGNED job).
    const updated = await tx.job.updateMany({
      where: { id: job.id, status: job.status, workerId: job.workerId },
      data: { status: plan.to, workerId: plan.workerId },
    });
    if (updated.count !== 1) continue;

    const change: JobStatusChange = {
      jobId: job.id,
      jobNumber: job.jobNumber,
      customerId: job.customerId,
      transition: request.transition,
      from: plan.from,
      to: plan.to,
      workerBefore: job.workerId,
      workerAfter: plan.workerId,
      actor: request.actor,
      reason: plan.reason,
    };
    await deps.audit(tx, {
      actorId: actorId(request.actor),
      action: plan.action,
      recordType: "jobs",
      recordId: job.id,
      before: { status: plan.from, workerId: job.workerId },
      after: { status: plan.to, workerId: plan.workerId },
      reason: plan.reason,
    });
    await deps.notify(tx, change);
    return change;
  }
  throw new JobTransitionConflictError(request.jobId, request.transition);
}

/** Reads only what the transition's preconditions need. */
async function loadFacts(tx: Tx, job: JobSnapshot, request: TransitionRequest): Promise<JobFacts> {
  const jobId = job.id;
  switch (request.transition) {
    case "send-price":
      return { hasPricing: (await tx.jobPricing.count({ where: { jobId } })) > 0 };

    case "mark-paid":
      return { jobPaymentPaid: (await tx.payment.count({ where: { jobId, kind: "JOB", status: "PAID" } })) > 0 };

    case "decline-price":
    case "cancel":
      return {
        moneyHeld: (await tx.payment.count({ where: { jobId, status: { in: ["PAID", "PARTIALLY_REFUNDED"] } } })) > 0,
      };

    case "claim": {
      if (request.actor.role === "SYSTEM" || job.category === "OTHER") return {};
      const today = startOfUtcDay(request.now ?? new Date());
      const licences = await tx.licence.count({
        where: {
          userId: request.actor.userId,
          trade: job.category,
          status: "VERIFIED",
          OR: [{ expiresOn: null }, { expiresOn: { gte: today } }],
        },
      });
      return { workerLicensed: licences > 0 };
    }

    case "submit": {
      const evidence = await tx.completionEvidence.findUnique({ where: { jobId }, select: { submittedAt: true } });
      const openExtraWork = await tx.variation.count({ where: { jobId, status: { in: ["REQUESTED", "PRICED"] } } });
      return { evidenceSentAt: evidence?.submittedAt ?? null, extraWorkOpen: openExtraWork > 0 };
    }

    case "auto-sign-off": {
      const evidence = await tx.completionEvidence.findUnique({ where: { jobId }, select: { submittedAt: true } });
      const openProblems = await tx.problemReport.count({ where: { jobId, status: "OPEN" } });
      const settings = await tx.settings.findUniqueOrThrow({ where: { id: 1 }, select: { autoReleaseHours: true } });
      return {
        evidenceSentAt: evidence?.submittedAt ?? null,
        problemOpen: openProblems > 0,
        autoReleaseHours: settings.autoReleaseHours,
      };
    }

    case "reinstate": {
      const entered = await tx.jobStatusHistory.findFirst({
        where: { jobId, toStatus: "CANCEL_REVIEW" },
        orderBy: { createdAt: "desc" },
        select: { fromStatus: true },
      });
      return { statusBeforeCancelReview: entered?.fromStatus ?? null };
    }

    default:
      return {};
  }
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
