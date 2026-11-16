import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { databaseSchema } from "@/server/database-client";
import { createNotify } from "@/server/notifications/notify";
import type { SchedulerRule } from "./rules";

const DAY_MS = 24 * 3_600_000;

/**
 * One customer notice for each still-unanswered price revision. The notice itself is the "already sent" record:
 * its event id is fixed per revision (so a replay can never make a second row), and the job's row lock makes two
 * runs at once take turns, so the second finds the first one's notice and skips.
 */
export const extraWorkReminder: SchedulerRule = {
  name: "extra-work-reminder",
  async run({ db, now, limit }) {
    const cutoff = new Date(now.getTime() - DAY_MS);
    const schema = databaseSchema(db).replaceAll('"', '""');
    const variations = Prisma.raw(`"${schema}"."variations"`);
    const jobs = Prisma.raw(`"${schema}"."jobs"`);
    const notifications = Prisma.raw(`"${schema}"."notifications"`);
    // Exclude already-reminded revisions before applying the batch limit, so old ones cannot starve later work.
    const due = await db.$queryRaw<{ id: string; jobId: string; revision: number }[]>(Prisma.sql`
      SELECT v.id, v.job_id AS "jobId", v.revision
      FROM ${variations} v JOIN ${jobs} j ON j.id = v.job_id
      WHERE v.status = 'PRICED' AND v.priced_at <= ${cutoff} AND j.status = 'ASSIGNED'
        AND NOT EXISTS (SELECT 1 FROM ${notifications} n WHERE n.user_id = j.customer_id AND n.type = 'variation.reminder'
          AND n.payload->>'variationId' = v.id::text AND n.payload->>'revision' = v.revision::text)
      ORDER BY v.priced_at ASC, v.id ASC LIMIT ${limit}
    `);
    const result = { rule: "extra-work-reminder", due: due.length, done: 0, skipped: 0, failed: 0 };
    for (const candidate of due) {
      try {
        const outcome = await db.$transaction(async tx => {
          // Variation decisions/pricing and job transitions also lock the parent first. Read again after waiting.
          await tx.$queryRaw(Prisma.sql`SELECT id FROM ${jobs} WHERE id = ${candidate.jobId}::uuid FOR UPDATE`);
          const variation = await tx.variation.findFirst({
            where: { id: candidate.id, revision: candidate.revision, status: "PRICED", pricedAt: { lte: cutoff }, job: { status: "ASSIGNED" } },
            select: { id: true, revision: true, job: { select: { id: true, jobNumber: true, customerId: true } } },
          });
          if (!variation) return "skipped";
          const sent = await tx.notification.findFirst({ where: { userId: variation.job.customerId, type: "variation.reminder",
            AND: [{ payload: { path: ["variationId"], equals: variation.id } }, { payload: { path: ["revision"], equals: variation.revision } }] }, select: { id: true } });
          if (sent) return "skipped";
          await createNotify(tx)("variation.reminder", [variation.job.customerId], {
            eventId: `variation.reminder:${variation.id}:${variation.revision}`,
            payload: { jobId: variation.job.id, jobNumber: variation.job.jobNumber, variationId: variation.id, revision: variation.revision },
          });
          return "done";
        });
        result[outcome]++;
      } catch {
        result.failed++;
        console.error("Extra-work reminder could not be delivered.");
      }
    }
    return result;
  },
};
