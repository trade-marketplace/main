import "server-only";
import { notFound } from "next/navigation";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { MY_WORK_COLUMNS, myWorkColumn, quoteOutcome, type MyQuotesData, type MyWorkData, type MyWorkJob } from "@/lib/my-work";
import { redactContactDetails } from "@/lib/problem-threads";
import { payoutTotal } from "@/lib/earnings";
import { calculatePayout } from "@/server/payouts/calculate";
import { canReadJob, workerHasPrivateAccess, workerJobListView, type JobViewer } from "@/server/views";

const SELECT = {
  id: true, jobNumber: true, title: true, suburb: true, status: true, workerId: true, customerId: true,
  category: true, city: true, asap: true, createdAt: true, updatedAt: true,
  bookedDate: true, bookedTime: true, pricing: { select: { workerGrossCents: true, holidayPayCents: true, minutes: true, workerRateCents: true, holidayPayBps: true } },
  variations: { where: { status: "APPROVED", minutes: { not: null } }, select: { minutes: true } },
  statusHistory: { where: { toStatus: "COMPLETED" }, orderBy: { createdAt: "desc" }, take: 1, select: { toStatus: true, createdAt: true } },
  evidence: { select: { submittedAt: true } },
  _count: { select: { problems: { where: { status: "OPEN" } }, variations: { where: { status: "PRICED" } } } },
} satisfies Prisma.JobSelect;
const ASSIGNMENT_PROOF_LIMIT = 2000;

/** One owner-scoped job query. Only the five newest Done cards leave this reader, with its full total. */
export async function loadMyWork(db: Pick<PrismaClient, "job" | "settings" | "auditLog">, viewer: JobViewer): Promise<MyWorkData> {
  if (viewer.role !== "TRADIE" || !viewer.userId) notFound();
  const [rows, settings] = await Promise.all([
    db.job.findMany({ where: { workerId: viewer.userId, status: { in: ["ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW"] } }, select: { ...SELECT,
      payouts: { where: { workerId: viewer.userId }, select: { status: true, grossCents: true, holidayPayCents: true }, take: 1 },
    }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }] }),
    db.settings.findUnique({ where: { id: 1 }, select: { autoReleaseHours: true } }),
  ]);
  // Status history cannot prove a same-status reassignment. Read immutable assignment proof for owned jobs
  // only, without the office's reason/snapshots. Repeated assignments to this worker remain ambiguous (#522).
  const assignments = rows.length ? await db.auditLog.findMany({ where: { recordType: "jobs", recordId: { in: rows.map(row => row.id) },
    OR: [{ action: { in: ["job.claimed", "job.reassigned"] } }, { action: "job.status_overridden", NOT: { before: { path: ["workerId"], equals: viewer.userId } } }],
    after: { path: ["workerId"], equals: viewer.userId } }, take: ASSIGNMENT_PROOF_LIMIT,
    select: { recordId: true, createdAt: true } }) : [];
  const assignmentProof = new Map<string, string | null>();
  // A capped history cannot prove uniqueness, so omit dates rather than guessing from a partial result.
  if (assignments.length < ASSIGNMENT_PROOF_LIMIT) for (const proof of assignments) assignmentProof.set(proof.recordId, assignmentProof.has(proof.recordId) ? null : proof.createdAt.toISOString());
  const columns: MyWorkData["columns"] = { "to-book": [], "on-now": [], "waiting-sign-off": [], done: [] };
  const completedOrder = new Map<string, string>();
  for (const row of rows) {
    const safe = workerJobListView(viewer, row);
    if (!safe?.assignedToYou) continue;
    let earnCents = row.payouts[0] ? payoutTotal(row.payouts[0]) : safe.earnCents;
    if (!row.payouts[0] && row.pricing && row.variations.length) {
      try { earnCents = calculatePayout({ jobMinutes: row.pricing.minutes, approvedExtraMinutes: row.variations.map(extra => extra.minutes!), workerRateCents: row.pricing.workerRateCents, holidayPayBps: row.pricing.holidayPayBps }).totalCents; }
      catch { earnCents = null; console.error("My work earnings unavailable."); }
    }
    const job: MyWorkJob = { id: safe.id, jobNumber: safe.jobNumber, title: safe.title, suburb: safe.suburb, status: row.status as MyWorkJob["status"],
      bookedDate: row.bookedDate?.toISOString().slice(0, 10) ?? null, bookedTime: row.bookedTime,
      claimedAt: assignmentProof.get(row.id) ?? null,
      completedAt: row.statusHistory.find(item => item.toStatus === "COMPLETED")?.createdAt.toISOString() ?? null,
      submittedAt: row.evidence?.submittedAt?.toISOString() ?? null, earnCents,
      openProblems: row._count.problems, openExtraWork: row._count.variations, payout: row.payouts[0]?.status === "PAID" ? "Paid" : "Queued" };
    columns[myWorkColumn(job)].push(job);
    completedOrder.set(job.id, job.completedAt ?? row.updatedAt.toISOString());
  }
  columns.done.sort((a, b) => completedOrder.get(b.id)!.localeCompare(completedOrder.get(a.id)!) || a.id.localeCompare(b.id));
  const counts = Object.fromEntries(MY_WORK_COLUMNS.map(column => [column, columns[column].length])) as MyWorkData["counts"];
  columns.done = columns.done.slice(0, 5);
  return { columns, counts, jobsOn: counts["to-book"] + counts["on-now"], autoReleaseHours: settings?.autoReleaseHours ?? 48 };
}

export async function loadMyQuotes(db: Pick<PrismaClient, "estimate">, viewer: JobViewer): Promise<MyQuotesData> {
  if (viewer.role !== "TRADIE" || !viewer.userId) notFound();
  const [rows, total] = await Promise.all([
    db.estimate.findMany({ where: { workerId: viewer.userId }, take: 50, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: {
      id: true, createdAt: true, job: { select: { id: true, title: true, suburb: true, status: true, workerId: true, customerId: true } },
    } }), db.estimate.count({ where: { workerId: viewer.userId } }),
  ]);
  return { total, rows: rows.map(row => ({ id: row.id, jobId: row.job.id, title: redactContactDetails(row.job.title, workerHasPrivateAccess(viewer, row.job)), suburb: row.job.suburb, sentAt: row.createdAt.toISOString(),
    outcome: quoteOutcome(row.job.status, row.job.workerId, viewer.userId), canOpen: canReadJob(viewer, row.job) })) };
}
