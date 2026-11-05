import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { customerJobDetailsSchema, waitingJobRevision, type WaitingJobResult } from "@/lib/customer-job-waiting";
import { createAudit } from "@/server/audit/audit";
import { createNotify } from "@/server/notifications/notify";
import { databaseSchema } from "@/server/database-client";
import type { JobViewer } from "@/server/views";
import { applyTransition } from "./status-machine";

/** The job row serializes edits with pricing; stale pages never overwrite new details or cancel a priced job. */
export async function changeWaitingJob(db: PrismaClient, viewer: JobViewer, id: unknown, revision: unknown, command: "edit" | "cancel", input?: unknown): Promise<WaitingJobResult> {
  if (viewer.role !== "CUSTOMER" || !z.uuid().safeParse(id).success || typeof revision !== "string") return { status: "forbidden" };
  const jobId = id as string;
  const parsed = customerJobDetailsSchema.safeParse(input);
  if (command === "edit" && !parsed.success) return { status: "invalid", fields: Object.fromEntries(parsed.error.issues.map(issue => [issue.path[0], issue.message])) };
  try {
    const relation = `"${databaseSchema(db).replaceAll('"', '""')}".jobs`;
    return await db.$transaction(async tx => {
      // Only an owned row is locked. No write is used to acquire the lock, so a refusal has no side effects.
      await tx.$queryRawUnsafe(`SELECT id FROM ${relation} WHERE id = $1::uuid AND customer_id = $2::uuid FOR UPDATE`, jobId, viewer.userId);
      const profile = await tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } });
      const job = await tx.job.findFirst({ where: { id: jobId, customerId: viewer.userId }, select: { id: true, jobNumber: true, status: true, updatedAt: true, title: true, description: true, accessNotes: true } });
      if (!job || profile?.role !== "CUSTOMER") return { status: "forbidden" };
      const before = { title: job.title, description: job.description, accessNotes: job.accessNotes ?? "" };
      if (job.status !== "REVIEW" || waitingJobRevision(job.updatedAt.toISOString(), before) !== revision) return { status: "changed" };
      // This dialog promises a free cancellation, and must never create a paid cancellation request.
      if (command === "cancel") {
        if (await tx.payment.count({ where: { jobId, status: { in: ["PAID", "PARTIALLY_REFUNDED"] } } })) return { status: "changed" };
        let eventId = "";
        await applyTransition(tx, {
          audit: async (_tx, entry) => { const audit = await createAudit(tx)(viewer, "job.cancelled", { type: "jobs", id: jobId }, entry.before, entry.after, "Customer cancelled before payment."); eventId = `job.cancelled:${audit.id}`; },
          notify: async () => { await createNotify(tx)("job.cancelled", [viewer.userId], { eventId, payload: { jobId, jobNumber: job.jobNumber } }); },
        }, { jobId, transition: "cancel", actor: viewer });
        return { status: "cancelled" };
      }
      if (!parsed.success) return { status: "invalid", fields: {} };
      if (JSON.stringify(before) === JSON.stringify(parsed.data)) return { status: "saved" };
      await tx.job.update({ where: { id: jobId }, data: { ...parsed.data, accessNotes: parsed.data.accessNotes || null } });
      const audit = await createAudit(tx)(viewer, "job.details_updated", { type: "jobs", id: jobId }, before, parsed.data);
      const quoters = await tx.estimate.findMany({ where: { jobId }, select: { workerId: true } });
      await createNotify(tx)("job.details_updated", quoters.map(row => row.workerId), { eventId: `job.details_updated:${audit.id}`, payload: { jobId, jobNumber: job.jobNumber } });
      return { status: "saved" };
    });
  } catch { return { status: "unavailable" }; }
}
