import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { databaseSchema } from "@/server/database-client";
import { createNotify, notificationId } from "@/server/notifications/notify";
import { createAudit, SYSTEM_ACTOR } from "@/server/audit/audit";
import { canClaim, eligibilityFailure, JOB_ELIGIBILITY_SELECT, WORKER_ELIGIBILITY_SELECT, type EligibilityContext, type EligibilityJob, type EligibilityWorker } from "@/server/workers/eligibility";
import type { RuleResult, SchedulerRule } from "./rules";

const DAY = 24 * 3_600_000;
const CAP = 10;
type PingStatus = "BOOKABLE" | "QUOTE_BOUNTY";
type DueJob = { id: string; status: PingStatus };

/** Ready to claim: who could claim it. A bounty: who sees it on their board (there is no bounty-quote check yet, #593). */
function canBePinged(status: PingStatus, worker: EligibilityWorker, job: EligibilityJob, context: EligibilityContext): boolean {
  return status === "BOOKABLE" ? canClaim(worker, job, context) : eligibilityFailure(worker, job, "discover", context) === null;
}

export function jobPingQuietHours(now: Date): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", hour: "numeric", hourCycle: "h23" }).format(now));
  return hour >= 21 || hour < 7;
}

/** Legacy bounty notifications have a different durable source id and do not spend this rule's cap. */
async function hasDailyCap(tx: Prisma.TransactionClient, userId: string, since: Date): Promise<boolean> {
  let cursor: { id: string } | undefined;
  let count = 0;
  for (;;) {
    // Rows queued earlier in this invocation have DB timestamps after its fixed business clock.
    const rows = await tx.notification.findMany({
      where: { userId, type: { in: ["job.ready_to_claim", "bounty.available"] }, createdAt: { gte: since } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50,
      ...(cursor && { cursor, skip: 1 }), select: { id: true, type: true, payload: true },
    });
    for (const row of rows) {
      const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {};
      const status = row.type === "job.ready_to_claim" ? "BOOKABLE" : "QUOTE_BOUNTY";
      if (typeof payload.jobId === "string" && typeof payload.enteredAt === "string" && row.id === notificationId(`job-ping:${status}:${payload.jobId}:${payload.enteredAt}`, userId) && ++count >= CAP) return true;
    }
    if (rows.length < 50) return false;
    cursor = { id: rows[rows.length - 1].id };
  }
}

/**
 * Each entry into a status pings once (a job handed back and ready to claim again pings again). The record that it happened is a `job.pings_sent` audit entry, written in the same
 * transaction as the in-app rows under the job's row lock, so two runs at once take turns and the second skips.
 */
export const jobPings: SchedulerRule = {
  name: "job-pings",
  async run(context) {
    const result: RuleResult = { rule: "job-pings", due: 0, done: 0, skipped: 0, failed: 0 };
    if (jobPingQuietHours(context.now) || (context.deadlineAt && Date.now() >= context.deadlineAt.getTime())) return result;
    const since = new Date(context.now.getTime() - DAY);
    const schema = databaseSchema(context.db).replaceAll('"', '""');
    const table = (name: "jobs" | "job_status_history" | "audit_log" | "profiles" | "worker_profiles") => Prisma.raw(`"${schema}"."${name}"`);
    const due = await context.db.$queryRaw<DueJob[]>(Prisma.sql`
      SELECT j.id, j.status FROM ${table("jobs")} AS j
      JOIN LATERAL (
        SELECT h.to_status, h.created_at FROM ${table("job_status_history")} AS h
        WHERE h.job_id = j.id ORDER BY h.created_at DESC, h.id DESC LIMIT 1
      ) AS latest ON latest.to_status = j.status
      WHERE j.status::text IN ('BOOKABLE', 'QUOTE_BOUNTY')
        AND latest.created_at >= ${since} AND latest.created_at <= ${context.now}
        AND NOT EXISTS (SELECT 1 FROM ${table("audit_log")} AS a
          WHERE a.record_type = 'jobs' AND a.record_id = j.id::text AND a.action = 'job.pings_sent' AND a.after->>'status' = j.status::text
            AND (a.after->>'enteredAt')::timestamptz = date_trunc('milliseconds', latest.created_at))
      ORDER BY latest.created_at ASC, j.id ASC LIMIT ${context.limit}
    `);
    result.due = due.length;
    for (const candidate of due) {
      const remaining = context.deadlineAt ? context.deadlineAt.getTime() - Date.now() : 30_000;
      if (remaining <= 0) break;
      try {
        const outcome = await context.db.$transaction(async tx => {
          // Lock without changing updated_at or creating artificial job activity.
          const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM ${table("jobs")} WHERE id = ${candidate.id}::uuid FOR UPDATE`);
          if (!locked.length) return "skipped";
          const job = await tx.job.findUnique({ where: { id: candidate.id }, select: {
            ...JOB_ELIGIBILITY_SELECT, jobNumber: true,
            statusHistory: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { toStatus: true, createdAt: true } },
          } });
          const latest = job?.statusHistory[0];
          if (!job || job.status !== candidate.status || latest?.toStatus !== job.status || latest.createdAt < since || latest.createdAt > context.now) return "skipped";
          const sent = await tx.auditLog.findFirst({ where: { recordType: "jobs", recordId: job.id, action: "job.pings_sent", AND: [{ after: { path: ["status"], equals: candidate.status } }, { after: { path: ["enteredAt"], equals: latest.createdAt.toISOString() } }] }, select: { id: true } });
          if (sent) return "skipped";
          const settings = await tx.settings.findUnique({ where: { id: 1 }, select: { enabledTrades: true } });
          const eligibility = { now: context.now, ...(settings && { enabledTrades: settings.enabledTrades }) };
          const candidates = await tx.profile.findMany({ where: { role: "TRADIE", workerProfile: { is: { available: true, pausedAt: null } } }, select: WORKER_ELIGIBILITY_SELECT, orderBy: { id: "asc" } });
          const recipients: string[] = [];
          for (const person of candidates) {
            // Avoid taking locks for people outside this job's eligibility/work area.
            if (!canBePinged(candidate.status, person, job, eligibility)) continue;
            // A shared per-worker lock serializes the rolling cap across different jobs and concurrent runs.
            // Lock in id order, then reread the current role, availability and eligibility facts.
            const workerLock = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
              SELECT p.id FROM ${table("profiles")} AS p JOIN ${table("worker_profiles")} AS w ON w.user_id = p.id
              WHERE p.id = ${person.id}::uuid FOR UPDATE OF p, w
            `);
            if (!workerLock.length) continue;
            const worker = await tx.profile.findUnique({ where: { id: person.id }, select: WORKER_ELIGIBILITY_SELECT });
            if (!worker?.workerProfile?.available || worker.workerProfile.pausedAt !== null) continue;
            const allowed = canBePinged(candidate.status, worker, job, eligibility);
            if (allowed && !await hasDailyCap(tx, worker.id, since)) recipients.push(worker.id);
          }
          await createNotify(tx)(candidate.status === "BOOKABLE" ? "job.ready_to_claim" : "bounty.available", recipients, {
            eventId: `job-ping:${candidate.status}:${job.id}:${latest.createdAt.toISOString()}`, payload: { jobId: job.id, jobNumber: job.jobNumber, enteredAt: latest.createdAt.toISOString() },
          });
          await createAudit(tx)(SYSTEM_ACTOR, "job.pings_sent", { type: "jobs", id: job.id }, null, { status: candidate.status, enteredAt: latest.createdAt.toISOString(), recipients: recipients.length });
          return "done";
        }, { timeout: Math.min(30_000, remaining), maxWait: Math.min(2_000, remaining) });
        result[outcome]++;
      } catch (error) {
        result.failed++;
        console.error("Ready-to-claim ping could not be queued.", error instanceof Error ? error.name : "unexpected-error");
      }
    }
    return result;
  },
};
