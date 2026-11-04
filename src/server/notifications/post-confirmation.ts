import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { resendMailer, type ContactMailer } from "@/server/contact";
import type { SchedulerRule } from "@/server/scheduler/rules";
import { frozenPostConfirmationMessage, postConfirmationEmail as renderPostConfirmationEmail, postConfirmationInput, type PostConfirmationInput } from "./post-confirmation-template";

export const POST_CONFIRMATION_MAX_ATTEMPTS = 5;
/** Resend retains keys for 24h. An unknown/lost response is never retried after this earlier operational cutoff. */
export const POST_CONFIRMATION_RETRY_WINDOW_MS = 23 * 60 * 60 * 1_000;
const PROVIDER_TIMEOUT_MS = 10_000;
const MIN_REMAINING_MS = 12_000;
const LEASE_MS = 30_000;

/** Called only in the actual job-creation transaction. Replays and success-page GETs must never enqueue. */
export async function enqueuePostConfirmation(tx: Pick<Prisma.TransactionClient, "jobPostConfirmation">, input: PostConfirmationInput): Promise<void> {
  const value = postConfirmationInput.parse(input);
  const message = renderPostConfirmationEmail(value);
  await tx.jobPostConfirmation.create({ data: { ...value, message: message as unknown as Prisma.InputJsonObject } });
}

type DeliveryOptions = { mailer?: ContactMailer | null; wallClock?: () => number };

async function boundedSend(mailer: ContactMailer, message: Parameters<ContactMailer>[0], key: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([mailer(message, key), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), PROVIDER_TIMEOUT_MS); })]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Durable claim → commit → provider → lease-token completion. No external request holds a database lock. */
export function createPostConfirmationRule(options: DeliveryOptions = {}): SchedulerRule {
  return {
    name: "post-confirmation-email",
    async run(context) {
      const wallClock = options.wallClock ?? Date.now;
      const started = wallClock();
      const deadline = context.deadlineAt?.getTime() ?? started + 15_000;
      const enoughTime = () => deadline - wallClock() >= MIN_REMAINING_MS;
      const now = () => new Date(context.now.getTime() + Math.max(0, wallClock() - started));
      const result = { rule: "post-confirmation-email", due: 0, done: 0, skipped: 0, failed: 0 };
      const limit = Number.isFinite(context.limit) ? Math.max(0, Math.min(2, Math.floor(context.limit))) : 0;
      if (!limit || !enoughTime()) return result;
      const pending = (at: Date) => ({ deliveredAt: null, failedAt: null, dueAt: { lte: at }, OR: [{ leasedUntil: null }, { leasedUntil: { lte: at } }] });
      const due = await context.db.jobPostConfirmation.findMany({ where: pending(now()), orderBy: [{ dueAt: "asc" }, { jobId: "asc" }], take: limit, select: { jobId: true } });
      result.due = due.length;
      const mailer = options.mailer === undefined ? resendMailer() : options.mailer;
      if (!mailer) { result.failed = due.length; return result; }

      for (const candidate of due) {
        if (!enoughTime()) { result.skipped++; continue; }
        try {
          const claim = await context.db.$transaction(async tx => {
            const at = now();
            const row = await tx.jobPostConfirmation.findUnique({ where: { jobId: candidate.jobId } });
            if (!row || row.deliveredAt || row.failedAt || row.dueAt > at || row.leasedUntil && row.leasedUntil > at) return null;
            const where = { jobId: row.jobId, ...pending(at), attempts: row.attempts, leaseToken: row.leaseToken };
            if (row.attempts >= POST_CONFIRMATION_MAX_ATTEMPTS || row.firstAttemptAt && at.getTime() - row.firstAttemptAt.getTime() >= POST_CONFIRMATION_RETRY_WINDOW_MS) {
              await tx.jobPostConfirmation.updateMany({ where, data: { failedAt: at, leaseToken: null, leasedUntil: null } });
              return null;
            }
            const leaseToken = randomUUID();
            const written = await tx.jobPostConfirmation.updateMany({ where, data: { leaseToken, leasedUntil: new Date(at.getTime() + LEASE_MS), attempts: { increment: 1 }, firstAttemptAt: row.firstAttemptAt ?? at } });
            if (!written.count) return null;
            const job = await tx.job.findUnique({ where: { id: row.jobId }, select: { customerId: true } });
            const customer = await tx.profile.findUnique({ where: { id: row.customerId }, select: { role: true, email: true, emailVerifiedAt: true } });
            const message = frozenPostConfirmationMessage.safeParse(row.message);
            const allowed = job?.customerId === row.customerId && customer?.role === "CUSTOMER" && customer.emailVerifiedAt !== null
              && customer.email === row.recipientEmail && message.success && message.data.to === row.recipientEmail;
            if (!allowed || !message.success) {
              await tx.jobPostConfirmation.updateMany({ where: { jobId: row.jobId, leaseToken, deliveredAt: null, failedAt: null }, data: { failedAt: at, leaseToken: null, leasedUntil: null } });
              return null;
            }
            return { jobId: row.jobId, leaseToken, attempts: row.attempts + 1, firstAttemptAt: row.firstAttemptAt ?? at,
              previousAttempts: row.attempts, previousFirstAttemptAt: row.firstAttemptAt, message: message.data };
          }, { timeout: 2_000, maxWait: 1_000 });
          if (!claim) { result.skipped++; continue; }
          const owned = { jobId: claim.jobId, leaseToken: claim.leaseToken, deliveredAt: null, failedAt: null };
          if (!enoughTime()) {
            // No provider request was made. Restore its attempt budget and original retention anchor only if
            // this is still our lease; an expired/reclaimed lease must never roll another worker backwards.
            await context.db.jobPostConfirmation.updateMany({ where: owned, data: { leaseToken: null, leasedUntil: null,
              attempts: claim.previousAttempts, firstAttemptAt: claim.previousFirstAttemptAt } });
            result.skipped++; continue;
          }
          let accepted = false;
          try { accepted = await boundedSend(mailer, claim.message, `posted:${claim.jobId}:EMAIL`); }
          catch { /* A provider error may include private payloads. Persist the retry without logging it. */ }
          const at = now();
          if (accepted) {
            // deliveredAt means provider-accepted, not an assertion about the customer's inbox or an open.
            const saved = await context.db.jobPostConfirmation.updateMany({ where: owned, data: { deliveredAt: at, leaseToken: null, leasedUntil: null } });
            result[saved.count ? "done" : "skipped"]++;
          } else {
            const dueAt = new Date(at.getTime() + 60_000 * 2 ** (claim.attempts - 1));
            const terminal = claim.attempts >= POST_CONFIRMATION_MAX_ATTEMPTS || dueAt.getTime() - claim.firstAttemptAt.getTime() >= POST_CONFIRMATION_RETRY_WINDOW_MS;
            const saved = await context.db.jobPostConfirmation.updateMany({ where: owned, data: { ...(terminal ? { failedAt: at } : { dueAt }), leaseToken: null, leasedUntil: null } });
            result[saved.count ? "failed" : "skipped"]++;
          }
        } catch { result.failed++; console.error("Posted confirmation email could not be processed."); }
      }
      return result;
    },
  };
}

export const postConfirmationEmail = createPostConfirmationRule();
