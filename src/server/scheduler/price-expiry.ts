import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { createAudit, SYSTEM_ACTOR } from "@/server/audit/audit";
import { databaseSchema } from "@/server/database-client";
import { applyTransition, JobTransitionError } from "@/server/jobs/status-machine";
import { createNotify } from "@/server/notifications/notify";
import { retireJobPayments, type PaymentIntentsApi } from "@/server/payments/payments";
import { getStripe } from "@/server/payments/stripe";
import type { RuleResult, SchedulerRule } from "./rules";

// Price expiry (#508, DECISIONS.md "Price expiry"): a price the customer hasn't answered gets one reminder 3 days
// after it was sent, and the job closes for free 7 days after. "Sent" is the later of the job's latest move into
// PRICED and its latest (re-)price, so a revised price restarts the clock and allows one new reminder.
//
// No marks table: the reminder notification has a fixed id per price ("sent at"), and its payload carries that
// time, so a revision is reminded once and a replay never makes a second row. Closing is a status change, which
// only happens once. Each job is handled under its row lock, which the card form and the payment webhook also take,
// so paying and closing take turns: whichever is first wins, and the other sees the job has moved on.

export const PRICE_REMINDER_AFTER_MS = 3 * 24 * 3_600_000;
export const PRICE_EXPIRES_AFTER_MS = 7 * 24 * 3_600_000;
export const PRICE_EXPIRED_REASON = "No answer to the price for 7 days.";

type Due = { id: string; sentAt: Date };

function safeIntents(): PaymentIntentsApi | null {
  try { return getStripe().paymentIntents; } catch { return null; }
}

export function createPriceExpiryRule(options: { intents?: () => PaymentIntentsApi | null } = {}): SchedulerRule {
  return {
    name: "price-expiry",
    async run({ db, now, limit }): Promise<RuleResult> {
      const result: RuleResult = { rule: "price-expiry", due: 0, done: 0, skipped: 0, failed: 0 };
      const schema = databaseSchema(db).replaceAll('"', '""');
      const table = (name: string) => Prisma.raw(`"${schema}"."${name}"`);
      const sentAt = Prisma.sql`GREATEST(
        (SELECT max(h.created_at) FROM ${table("job_status_history")} h WHERE h.job_id = j.id AND h.to_status = 'PRICED'),
        (SELECT p.priced_at FROM ${table("job_pricing")} p WHERE p.job_id = j.id))`;
      const remindBy = new Date(now.getTime() - PRICE_REMINDER_AFTER_MS), closeBy = new Date(now.getTime() - PRICE_EXPIRES_AFTER_MS);
      const due = await db.$queryRaw<Due[]>(Prisma.sql`
        SELECT id, "sentAt" FROM (SELECT j.id, j.customer_id, ${sentAt} AS "sentAt" FROM ${table("jobs")} j WHERE j.status = 'PRICED') AS priced
        WHERE "sentAt" IS NOT NULL AND "sentAt" <= ${remindBy}
          AND ("sentAt" <= ${closeBy} OR NOT EXISTS (SELECT 1 FROM ${table("notifications")} n
            WHERE n.user_id = priced.customer_id AND n.type = 'job.price_reminder' AND n.payload->>'jobId' = priced.id::text
              AND (n.payload->>'sentAt')::timestamptz = "sentAt"))
        ORDER BY "sentAt" ASC, id ASC LIMIT ${limit}`);
      result.due = due.length;
      let intents: PaymentIntentsApi | null | undefined;
      for (const candidate of due) {
        try {
          const outcome = await db.$transaction(async (tx): Promise<"done" | "skipped"> => {
            await tx.$queryRaw(Prisma.sql`SELECT id FROM ${table("jobs")} WHERE id = ${candidate.id}::uuid FOR UPDATE`);
            const [row] = await tx.$queryRaw<{ status: string; customerId: string; jobNumber: number; sentAt: Date | null }[]>(Prisma.sql`
              SELECT j.status::text AS status, j.customer_id AS "customerId", j.job_number AS "jobNumber", ${sentAt} AS "sentAt"
              FROM ${table("jobs")} j WHERE j.id = ${candidate.id}::uuid`);
            if (!row || row.status !== "PRICED" || !row.sentAt || row.sentAt.getTime() > remindBy.getTime()) return "skipped";
            const payload = { jobId: candidate.id, jobNumber: row.jobNumber };
            if (row.sentAt.getTime() > closeBy.getTime()) {
              const reminded = await tx.notification.findFirst({ where: { userId: row.customerId, type: "job.price_reminder",
                AND: [{ payload: { path: ["jobId"], equals: candidate.id } }, { payload: { path: ["sentAt"], equals: row.sentAt.toISOString() } }] }, select: { id: true } });
              if (reminded) return "skipped";
              await createNotify(tx)("job.price_reminder", [row.customerId], {
                eventId: `job.price_reminder:${candidate.id}:${row.sentAt.toISOString()}`, payload: { ...payload, sentAt: row.sentAt.toISOString() },
              });
              return "done";
            }
            // Close: first make sure nothing can still take the money. A payment going through wins.
            if (intents === undefined) intents = (options.intents ?? safeIntents)();
            if (await retireJobPayments(tx, intents, SYSTEM_ACTOR, candidate.id, "The price closed after 7 days with no answer.") !== "retired") return "skipped";
            let eventId = "";
            const change = await applyTransition(tx, {
              audit: async (_tx, entry) => {
                const action = entry.after.status === "CANCEL_REVIEW" ? "job.cancel_requested" : "job.price_expired";
                const audit = await createAudit(tx)(SYSTEM_ACTOR, action, { type: "jobs", id: candidate.id }, entry.before, entry.after, entry.reason ?? PRICE_EXPIRED_REASON);
                eventId = `job.price_expired:${audit.id}`;
              },
              notify: async () => {},
            }, { jobId: candidate.id, transition: "expire-price", actor: { role: "SYSTEM", source: "scheduler" }, reason: PRICE_EXPIRED_REASON });
            await createNotify(tx)("job.price_expired", [row.customerId], { eventId, payload });
            if (change.to === "CANCEL_REVIEW") {
              // A paid quick look is held: the office decides any refund, as with "No thanks".
              const office = await tx.profile.findMany({ where: { role: "ADMIN" }, select: { id: true } });
              await createNotify(tx)("job.cancel_requested", office.map(person => person.id), { eventId: `${eventId}:office`, payload });
            }
            return "done";
          }, { timeout: 30_000 });
          result[outcome]++;
        } catch (error) {
          result.failed++;
          console.error("Price expiry: a job couldn't be handled.", error instanceof JobTransitionError ? error.code : "unexpected-error");
        }
      }
      return result;
    },
  };
}

export const priceExpiry = createPriceExpiryRule();
