import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { CUSTOMER_WORKER_UPDATE_TYPES, type CustomerWorkerCard, type CustomerWorkerUpdate, type CustomerWorkerUpdateType } from "@/lib/customer-worker-card";
import { getAvatarService } from "@/server/account/avatar-store";
import { NOTIFICATION_COPY } from "@/server/notifications/inbox";
import { hasCurrentTradeLicence, WORKER_VERIFICATION_SELECT } from "@/server/workers/verification";
import type { JobViewer } from "@/server/views";

type Db = Pick<PrismaClient, "job" | "notification" | "review">;
const avatarUrl = async (id: string, path: string | null) => {
  if (!path) return null;
  try { return await getAvatarService().avatarUrl(id, path); } catch { return null; }
};

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
    db.notification.findMany({ where: { userId: viewer.userId, payload: { path: ["jobId"], equals: jobId }, type: { in: [...CUSTOMER_WORKER_UPDATE_TYPES] } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 3,
      select: { id: true, type: true, createdAt: true, payload: true } }),
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
