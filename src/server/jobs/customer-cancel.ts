import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { JobViewer } from "@/server/views";
import { canCancelJob, cancelReasonSchema, cancelRevision, type CancelFacts, type CancelResult } from "@/lib/customer-cancel";
import { createAudit } from "@/server/audit/audit";
import { createNotify } from "@/server/notifications/notify";
import { databaseSchema } from "@/server/database-client";
import { applyTransition } from "./status-machine";

export async function loadCancelFacts(db: Pick<PrismaClient, "job" | "profile" | "auditLog">, viewer: JobViewer, jobId: string, now = new Date()): Promise<CancelFacts | null> {
  if (viewer.role !== "CUSTOMER" || !z.uuid().safeParse(jobId).success) return null;
  const job = await db.job.findFirst({ where: { id: jobId, customerId: viewer.userId, customer: { role: "CUSTOMER" } }, select: {
    status: true, worker: { select: { firstName: true } }, payments: { where: { status: { in: ["PAID", "PARTIALLY_REFUNDED"] } }, select: { id: true }, take: 1 },
  } });
  if (!job) return null;
  const onTheWay = Boolean(await db.auditLog.findFirst({ where: { recordType: "jobs", recordId: jobId, action: "job.on_my_way", createdAt: { gt: new Date(now.getTime() - 3 * 60 * 60 * 1000), lte: now } }, select: { id: true } }));
  return { canCancel: canCancelJob(job.status), paid: job.status === "BOOKABLE" || job.status === "ASSIGNED" || job.payments.length > 0, workerFirstName: job.worker?.firstName ?? null, onTheWay };
}

export async function cancelJob(db: PrismaClient, viewer: JobViewer, id: unknown, revision: unknown, reason?: unknown): Promise<CancelResult> {
  if (viewer.role !== "CUSTOMER" || !z.uuid().safeParse(id).success || typeof revision !== "string") return { status: "forbidden" };
  const jobId = id as string;
  try {
    const relation = `"${databaseSchema(db).replaceAll('"', '""')}".jobs`;
    return await db.$transaction(async tx => {
      await tx.$queryRawUnsafe(`SELECT id FROM ${relation} WHERE id = $1::uuid AND customer_id = $2::uuid FOR UPDATE`, jobId, viewer.userId);
      const profile = await tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } });
      const job = await tx.job.findFirst({ where: { id: jobId, customerId: viewer.userId }, select: { id: true, jobNumber: true, status: true, updatedAt: true, workerId: true } });
      if (!job || profile?.role !== "CUSTOMER") return { status: "forbidden" };
      if (job.status === "CANCELLED") return { status: "cancelled" };
      if (job.status === "CANCEL_REVIEW") return { status: "requested" };
      if (!canCancelJob(job.status) || revision !== cancelRevision(job.updatedAt.toISOString(), job.status)) return { status: "changed" };
      const paid = job.status === "BOOKABLE" || job.status === "ASSIGNED" || Boolean(await tx.payment.count({ where: { jobId, status: { in: ["PAID", "PARTIALLY_REFUNDED"] } } }));
      const parsed = cancelReasonSchema.safeParse(reason ?? "");
      if (paid && !parsed.success) return { status: "invalid", reason: parsed.error.issues[0]?.message ?? "Tell us why." };
      let eventId = "";
      const change = await applyTransition(tx, {
        audit: async (_tx, entry) => {
          const action = entry.action === "job.cancel_requested" ? "job.cancel_requested" : "job.cancelled";
          const audit = await createAudit(tx)(viewer, action, { type: "jobs", id: jobId }, entry.before, entry.after, entry.reason ?? "Customer cancelled before payment.");
          eventId = `${action}:${audit.id}`;
        },
        notify: async (_tx, change) => {
          const requested = change.to === "CANCEL_REVIEW";
          const office = requested ? await tx.profile.findMany({ where: { role: "ADMIN" }, select: { id: true } }) : [];
          await createNotify(tx)(requested ? "job.cancel_requested" : "job.cancelled", requested ? [...office.map(person => person.id), ...(job.workerId ? [job.workerId] : [])] : [viewer.userId], { eventId, payload: { jobId, jobNumber: job.jobNumber } });
        },
      }, { jobId, transition: "cancel", actor: viewer, reason: paid && parsed.success ? parsed.data : undefined });
      return { status: change.to === "CANCEL_REVIEW" ? "requested" : "cancelled" };
    });
  } catch (error) {
    if (error && typeof error === "object" && "failure" in error && error.failure === "reason-required") return { status: "invalid", reason: "Tell us why." };
    return { status: "unavailable" };
  }
}
