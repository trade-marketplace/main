import "server-only";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { CUSTOMER_WORKER_UPDATE_TYPES, type CustomerWorkerCard, type CustomerWorkerUpdate, type CustomerWorkerUpdateType } from "@/lib/customer-worker-card";
import { getAvatarService } from "@/server/account/avatar-store";
import { NOTIFICATION_COPY } from "@/server/notifications/inbox";
import { notificationId } from "@/server/notifications/notify";
import { hasCurrentTradeLicence, WORKER_VERIFICATION_SELECT } from "@/server/workers/verification";
import type { JobViewer } from "@/server/views";

type Db = Pick<PrismaClient, "job" | "review" | "auditLog" | "jobStatusHistory" | "notification">;
const UPDATE_ACTIONS = ["job.window_booked", "job.on_my_way", "job.running_late", "job.times_requested"];
const avatarUrl = async (id: string, path: string | null) => {
  if (!path) return null;
  try { return await getAvatarService().avatarUrl(id, path); } catch { return null; }
};

const ASSIGNMENTS = ["job.claimed", "job.reassigned", "job.status_overridden"];

function workerIn(snapshot: Prisma.JsonValue) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return undefined;
  return typeof snapshot.workerId === "string" || snapshot.workerId === null ? snapshot.workerId : undefined;
}

async function assignmentChanges(db: Pick<Db, "auditLog">, jobId: string) {
  // createAudit omits unchanged fields, including workerId on a status-only override.
  const rows = await db.auditLog.findMany({
    where: { recordType: "jobs", recordId: jobId, action: { in: ASSIGNMENTS },
      OR: [{ after: { path: ["workerId"], string_starts_with: "" } }, { before: { path: ["workerId"], string_starts_with: "" } }] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { createdAt: true, before: true, after: true, action: true, actorId: true },
  });
  return rows.filter(row => workerIn(row.before) !== workerIn(row.after));
}

// Audit rows are immutable. Counting entries into this worker's assignment avoids imposing a
// commit order on transaction-start timestamps or randomly generated audit UUIDs.
function entryCount(changes: Awaited<ReturnType<typeof assignmentChanges>>, workerId: string) {
  return changes.filter(row => workerIn(row.after) === workerId).length;
}

/** Read after checking the worker under the job lock; store the result in the update audit's after snapshot. */
export async function workerAssignmentGeneration(tx: Pick<Db, "auditLog">, jobId: string, workerId: string) {
  return entryCount(await assignmentChanges(tx, jobId), workerId);
}

async function assignmentUpdates(db: Db, customerId: string, jobId: string, workerId: string) {
  const changes = await assignmentChanges(db, jobId);
  const generation = entryCount(changes, workerId);
  if (!generation) return [];
  const [assignment, previous] = changes;
  const evidence: Prisma.AuditLogWhereInput[] = [
    { after: { path: ["workerAssignmentGeneration"], equals: generation } },
  ];
  // Legacy first assignments retain their existing proof. A returning claim can also prove
  // untagged updates when every assignment came through claim history: clock_timestamp() was
  // recorded under the job lock. Same-status office handoffs have no such history.
  const uniqueBoundary = workerIn(assignment.after) === workerId && (!previous || previous.createdAt < assignment.createdAt);
  if (uniqueBoundary && (generation === 1 || changes.every(row => row.action === "job.claimed"))) {
    let boundary: Date | undefined;
    if (assignment.action === "job.claimed" && assignment.actorId === workerId) {
      const claimed = await db.jobStatusHistory.findFirst({
        where: { jobId, fromStatus: "BOOKABLE", toStatus: "ASSIGNED", changedById: workerId, createdAt: { gte: assignment.createdAt } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { createdAt: true },
      });
      boundary = claimed?.createdAt;
    } else if (assignment.action !== "job.claimed") {
      boundary = assignment.createdAt;
    }
    if (boundary) evidence.push({ createdAt: { gte: new Date(boundary.getTime() + 1) } });
  }
  // The notification UUID must also match an immutable preset audit from this job and worker.
  const origins = await db.auditLog.findMany({
    where: { recordType: "jobs", recordId: jobId, actorId: workerId, action: { in: UPDATE_ACTIONS }, OR: evidence },
    select: { id: true, action: true },
  });
  if (!origins.length) return [];
  const events = origins.map(audit => ({ id: notificationId(`${audit.action}:${audit.id}`, customerId), type: audit.action === "job.times_requested" ? "job.reschedule_requested" : audit.action }));
  return db.notification.findMany({ where: { OR: events, userId: customerId, payload: { path: ["jobId"], equals: jobId }, type: { in: [...CUSTOMER_WORKER_UPDATE_TYPES] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 3, select: { id: true, type: true, createdAt: true, payload: true } });
}

/** Only public worker-card fields and this customer's job updates cross the server boundary. */
export async function loadCustomerWorkerCard(db: Db, viewer: JobViewer, jobId: string, signAvatar = avatarUrl, now = new Date(), expectedWorkerId?: string): Promise<CustomerWorkerCard | null> {
  if (viewer.role !== "CUSTOMER" || !z.uuid().safeParse(jobId).success) return null;
  const job = await db.job.findFirst({ where: { id: jobId, customerId: viewer.userId, customer: { role: "CUSTOMER" }, workerId: expectedWorkerId ?? { not: null }, status: { in: ["ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW"] } },
    select: { category: true, worker: { select: { id: true, role: true, avatarPath: true, workerTrades: WORKER_VERIFICATION_SELECT.workerTrades } } } });
  if (!job?.worker) return null;
  const worker = job.worker;
  const [avatar, rating, rows] = await Promise.all([
    signAvatar(worker.id, worker.avatarPath).catch(() => null),
    db.review.aggregate({ where: { workerId: worker.id, hiddenAt: null }, _avg: { rating: true }, _count: { _all: true } }),
    assignmentUpdates(db, viewer.userId, jobId, worker.id),
  ]);
  const updates = rows.map((row): CustomerWorkerUpdate => {
    const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {};
    const late = payload.lateMinutes;
    return { id: row.id, type: row.type as CustomerWorkerUpdateType, label: NOTIFICATION_COPY[row.type][0], createdAt: row.createdAt.toISOString(), lateMinutes: row.type === "job.running_late" && (late === 15 || late === 30 || late === 60) ? late : null };
  });
  return { avatarUrl: avatar, licensed: worker.role === "TRADIE" && job.category !== "OTHER" && hasCurrentTradeLicence(worker, job.category, now),
    rating: rating._count._all > 0 && rating._avg.rating !== null ? { average: Number(rating._avg.rating.toFixed(1)), count: rating._count._all } : null,
    updates, askedForTimes: updates[0]?.type === "job.reschedule_requested" };
}
