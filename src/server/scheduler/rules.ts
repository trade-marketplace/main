import "server-only";
import { extraWorkReminder } from "./extra-work-reminder";
import { variationPhotoCleanup } from "./variation-photo-cleanup";
import { variationStageCleanup } from "./variation-stage-cleanup";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { JobTransitionError, transitionJob } from "@/server/jobs/status-machine";
import { createNotify } from "@/server/notifications/notify";

import { schedulerDeps } from "./deps";
import { licenceDocumentCleanup } from "./licence-document-cleanup";
import { licenceUploadCleanup } from "./licence-upload-cleanup";
import { draftPhotoCleanup, draftPhotoRawCleanup } from "@/server/jobs/photo-cleanup";
import { licenceExpiryReminder } from "./licence-reminders";
import { supportPhotoCleanup } from "@/server/messages/photo-cleanup";
import { windowExpiry } from "./window-expiry";
import { postConfirmationEmail } from "@/server/notifications/post-confirmation";
import { priceReadyPush } from "@/server/notifications/price-push";
import { notificationEmailRule } from "@/server/notifications/email-rule";

// The time-based rules (#99). Each one is a small function that finds the jobs that are due, oldest first, and does
// its one thing to each, in that job's own transaction. They are safe to run twice, at once, or a day late:
//  - auto sign-off goes through the status machine, whose conditional update lets only one run win;
//  - the others write a `scheduled_job_marks` row first (primary key rule + job), and only the run that wrote it acts.
// A job that fails is logged and skipped; it never stops the jobs behind it. Anything not done this run is still due
// next minute, so after downtime the runner works through the backlog oldest first, `limit` jobs per rule per run.

export type SchedulerContext = {
  db: PrismaClient;
  now: Date;
  /** The most jobs one rule handles in one run. */
  limit: number;
  /** Physical invocation budget, independent of the injected business clock. */
  deadlineAt?: Date;
};

export type RuleResult = {
  rule: string;
  /** Jobs found due. */
  due: number;
  /** Jobs this run acted on. */
  done: number;
  /** Jobs another run (or the customer, or the office) got to first, or that stopped being due. */
  skipped: number;
  /** Jobs that threw. They are tried again next run. */
  failed: number;
};

export type SchedulerRule = { name: string; run: (context: SchedulerContext) => Promise<RuleResult> };

/** Unclaimed alert: a paid job nobody has taken for this long (sitemap `Unclaimed (alert > 48h)`). */
export const UNCLAIMED_AFTER_HOURS = 48;
/** The "taking longer than 24h" banner on the customer's job page (C07). */
export const PRICE_SLOW_AFTER_HOURS = 24;
/** Review reminder: a finished job with no review after this long… */
export const REVIEW_REMINDER_AFTER_HOURS = 24;
/** …and no later than this (reviews are editable for 7 days; an old reminder is just noise). */
export const REVIEW_REMINDER_UNTIL_DAYS = 7;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

type Tx = Prisma.TransactionClient;
type Outcome = "done" | "skipped";

/** Thrown inside a mark's transaction to roll the mark back when the job turns out not to need the effect. */
class SkipJob extends Error {}

function emptyResult(rule: string): RuleResult {
  return { rule, due: 0, done: 0, skipped: 0, failed: 0 };
}

/** Runs `handle` for each job id in order. One failing job is counted and logged, never thrown. */
async function eachJob(rule: string, ids: readonly string[], handle: (jobId: string) => Promise<Outcome>): Promise<RuleResult> {
  const result = { ...emptyResult(rule), due: ids.length };
  for (const jobId of ids) {
    try {
      result[await handle(jobId)]++;
    } catch (error) {
      result.failed++;
      console.error(`Scheduled rule ${rule} failed for job ${jobId}.`, error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/**
 * Writes the mark and then runs `effect`, in one transaction: if the effect fails the mark is rolled back and the job
 * is due again next run; if another run already marked it, nothing happens. `status` is re-checked inside, so a job
 * that moved on since the search (the bounty got priced, the job got claimed) is left alone.
 */
async function markOnce(
  context: SchedulerContext,
  rule: string,
  jobId: string,
  status: "REVIEW" | "QUOTE_BOUNTY" | "BOOKABLE" | "COMPLETED",
  effect: (tx: Tx, job: { id: string; jobNumber: number; customerId: string }) => Promise<void>,
): Promise<Outcome> {
  return context.db.$transaction(async (tx) => {
    const job = await tx.job.findFirst({ where: { id: jobId, status }, select: { id: true, jobNumber: true, customerId: true } });
    if (!job) return "skipped";
    const written = await tx.scheduledJobMark.createMany({ data: [{ rule, jobId, markedAt: context.now }], skipDuplicates: true });
    if (written.count !== 1) return "skipped";
    await effect(tx, job);
    return "done";
  });
}

async function officeIds(tx: Tx): Promise<string[]> {
  return (await tx.profile.findMany({ where: { role: "ADMIN" }, select: { id: true } })).map((profile) => profile.id);
}

/**
 * Jobs now in `status` that entered it (the latest time the status history says so) at or before `enteredBefore` and
 * carry no mark for `rule`, oldest first. `enteredAfter` and `jobWhere` narrow it further.
 */
async function dueByStatus(
  context: SchedulerContext,
  rule: string,
  status: "QUOTE_BOUNTY" | "BOOKABLE" | "COMPLETED",
  enteredBefore: Date,
  narrow: { enteredAfter?: Date; jobWhere?: Prisma.JobWhereInput } = {},
): Promise<string[]> {
  const rows = await context.db.jobStatusHistory.groupBy({
    by: ["jobId"],
    where: { toStatus: status, job: { status, scheduledMarks: { none: { rule } }, ...narrow.jobWhere } },
    having: { createdAt: { _max: { lte: enteredBefore, ...(narrow.enteredAfter && { gt: narrow.enteredAfter }) } } },
    orderBy: [{ _max: { createdAt: "asc" } }, { jobId: "asc" }],
    take: context.limit,
  });
  return rows.map((row) => row.jobId);
}

// ---------------------------------------------------------------- The rules

/** Auto sign-off: a submitted job the customer hasn't answered for `settings.auto_release_hours` (48) is completed. */
export const autoSignOff: SchedulerRule = {
  name: "auto-sign-off",
  async run(context) {
    const settings = await context.db.settings.findUniqueOrThrow({ where: { id: 1 }, select: { autoReleaseHours: true } });
    const cutoff = new Date(context.now.getTime() - settings.autoReleaseHours * HOUR_MS);
    const due = await context.db.job.findMany({
      where: {
        status: "SUBMITTED",
        evidence: { is: { submittedAt: { lte: cutoff } } },
        // An open problem report pauses the timer; leaving those out also keeps them from filling every batch.
        problems: { none: { status: "OPEN" } },
      },
      orderBy: [{ evidence: { submittedAt: "asc" } }, { id: "asc" }],
      take: context.limit,
      select: { id: true },
    });
    return eachJob("auto-sign-off", due.map((job) => job.id), async (jobId) => {
      try {
        await transitionJob(context.db, schedulerDeps, {
          jobId,
          transition: "auto-sign-off",
          actor: { role: "SYSTEM", source: "scheduler" },
          now: context.now,
        });
        return "done";
      } catch (error) {
        // The customer signed off first, a problem was opened, or another run got there: nothing to do.
        if (error instanceof JobTransitionError) return "skipped";
        throw error;
      }
    });
  },
};

/**
 * Bounty expiry: a quote bounty open for `settings.bounty_expiry_hours` (24) is marked expired and the office told.
 * The job stays QUOTE_BOUNTY: what happens to an expired bounty isn't decided yet (DECISIONS.md "Still to decide"),
 * so this only records it (the office pricing queue, F15, reads the mark) until that is.
 */
export const bountyExpiry: SchedulerRule = {
  name: "bounty-expiry",
  async run(context) {
    const settings = await context.db.settings.findUniqueOrThrow({ where: { id: 1 }, select: { bountyExpiryHours: true } });
    const cutoff = new Date(context.now.getTime() - settings.bountyExpiryHours * HOUR_MS);
    const ids = await dueByStatus(context, "bounty.expired", "QUOTE_BOUNTY", cutoff);
    return eachJob("bounty-expiry", ids, (jobId) =>
      markOnce(context, "bounty.expired", jobId, "QUOTE_BOUNTY", async (tx, job) => {
        await createNotify(tx)("bounty.expired", await officeIds(tx), {
          eventId: `scheduler:bounty.expired:${job.id}`,
          payload: { jobId: job.id, jobNumber: job.jobNumber },
        });
      }),
    );
  },
};

/** Unclaimed alert: a paid job (BOOKABLE) with no worker after 48 hours is flagged and the office told, once. */
export const unclaimedAlert: SchedulerRule = {
  name: "unclaimed-alert",
  async run(context) {
    const cutoff = new Date(context.now.getTime() - UNCLAIMED_AFTER_HOURS * HOUR_MS);
    const ids = await dueByStatus(context, "job.unclaimed", "BOOKABLE", cutoff);
    return eachJob("unclaimed-alert", ids, (jobId) =>
      markOnce(context, "job.unclaimed", jobId, "BOOKABLE", async (tx, job) => {
        await createNotify(tx)("job.unclaimed", await officeIds(tx), {
          eventId: `scheduler:job.unclaimed:${job.id}`,
          payload: { jobId: job.id, jobNumber: job.jobNumber },
        });
      }),
    );
  },
};

/**
 * "Taking longer than 24h": a job still waiting for its price (REVIEW) 24 hours after it was posted gets a mark. The
 * customer's job page shows the banner while the mark exists and the job is still REVIEW. No notification.
 */
export const priceSlowBanner: SchedulerRule = {
  name: "price-slow-banner",
  async run(context) {
    const cutoff = new Date(context.now.getTime() - PRICE_SLOW_AFTER_HOURS * HOUR_MS);
    const due = await context.db.job.findMany({
      where: { status: "REVIEW", createdAt: { lte: cutoff }, scheduledMarks: { none: { rule: "price.slow" } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: context.limit,
      select: { id: true },
    });
    return eachJob("price-slow-banner", due.map((job) => job.id), (jobId) =>
      markOnce(context, "price.slow", jobId, "REVIEW", async () => {}),
    );
  },
};

/**
 * Review reminder: the customer of a job completed 24 hours ago (and not more than 7 days) who hasn't left a review
 * gets one reminder.
 */
export const reviewReminder: SchedulerRule = {
  name: "review-reminder",
  async run(context) {
    const cutoff = new Date(context.now.getTime() - REVIEW_REMINDER_AFTER_HOURS * HOUR_MS);
    const floor = new Date(context.now.getTime() - REVIEW_REMINDER_UNTIL_DAYS * DAY_MS);
    const ids = await dueByStatus(context, "review.reminded", "COMPLETED", cutoff, {
      enteredAfter: floor,
      jobWhere: { review: { is: null } },
    });
    return eachJob("review-reminder", ids, (jobId) =>
      markOnce(context, "review.reminded", jobId, "COMPLETED", async (tx, job) => {
        // The review may have arrived since the search.
        if ((await tx.review.count({ where: { jobId: job.id } })) > 0) throw new SkipJob();
        await createNotify(tx)("review.reminder", [job.customerId], {
          eventId: `scheduler:review.reminded:${job.id}`,
          payload: { jobId: job.id, jobNumber: job.jobNumber },
        });
      }).catch((error: unknown) => {
        if (error instanceof SkipJob) return "skipped" as const;
        throw error;
      }),
    );
  },
};

/** In the order they run. Money-relevant (sign-off) first. */
export const SCHEDULER_RULES: readonly SchedulerRule[] = [autoSignOff, bountyExpiry, priceSlowBanner, unclaimedAlert, reviewReminder, licenceExpiryReminder, licenceUploadCleanup(), licenceDocumentCleanup(), supportPhotoCleanup(), draftPhotoRawCleanup(), draftPhotoCleanup(), windowExpiry, variationPhotoCleanup(), variationStageCleanup(), postConfirmationEmail, priceReadyPush, notificationEmailRule, extraWorkReminder];
