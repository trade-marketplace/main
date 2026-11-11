import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { DECLINE_PRICE_REASONS, type DeclinePriceResult } from "@/lib/customer-price";
import { createAudit } from "@/server/audit/audit";
import { createNotify } from "@/server/notifications/notify";
import { databaseSchema } from "@/server/database-client";
import type { JobViewer } from "@/server/views";
import { applyTransition } from "./status-machine";

export async function declineCustomerPrice(db: PrismaClient, viewer: JobViewer, id: unknown, revision: unknown, reason: unknown): Promise<DeclinePriceResult> {
  if (viewer.role !== "CUSTOMER" || !z.uuid().safeParse(id).success || typeof revision !== "string") return { status: "forbidden" };
  const selected = z.enum(DECLINE_PRICE_REASONS).nullish().safeParse(reason);
  if (!selected.success) return { status: "invalid" };
  const jobId = id as string;
  try {
    const relation = `"${databaseSchema(db).replaceAll('"', '""')}".jobs`;
    return await db.$transaction(async tx => {
      await tx.$queryRawUnsafe(`SELECT id FROM ${relation} WHERE id = $1::uuid AND customer_id = $2::uuid FOR UPDATE`, jobId, viewer.userId);
      const profile = await tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } });
      const job = await tx.job.findFirst({ where: { id: jobId, customerId: viewer.userId }, select: { id: true, jobNumber: true, status: true, updatedAt: true } });
      if (!job || profile?.role !== "CUSTOMER") return { status: "forbidden" };
      if (job.status !== "PRICED" || job.updatedAt.toISOString() !== revision) return { status: "changed" };
      let eventId = "";
      // The machine and cancellation audit require a reason when funds are held. The optional
      // customer selection remains null in the audit when they simply confirm “No thanks”.
      const transitionReason = selected.data ?? "No thanks";
      await applyTransition(tx, {
        audit: async (_tx, entry) => {
          const audit = await createAudit(tx)(viewer, entry.after.status === "CANCEL_REVIEW" ? "job.cancel_requested" : "job.cancelled", { type: "jobs", id: jobId }, entry.before,
            { ...entry.after, decline: { reason: selected.data ?? null } }, transitionReason);
          eventId = `job.cancelled:${audit.id}`;
        },
        notify: async () => { await createNotify(tx)("job.cancelled", [viewer.userId], { eventId, payload: { jobId, jobNumber: job.jobNumber } }); },
      }, { jobId, transition: "decline-price", actor: viewer, reason: transitionReason });
      return { status: "declined" };
    });
  } catch { return { status: "unavailable" }; }
}
