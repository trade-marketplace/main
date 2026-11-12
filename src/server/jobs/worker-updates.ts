import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { JobUpdateResult } from "@/lib/worker-workspace";
import { createAudit } from "@/server/audit/audit";
import { createNotify } from "@/server/notifications/notify";
import { consumeForUser } from "@/server/rate-limit";
import type { JobViewer } from "@/server/views";
import { lockJobWindows } from "./window-lock";

const actions = { "on-my-way": "job.on_my_way", "running-late": "job.running_late", "customer-not-home": "job.customer_not_home" } as const;
type Dependencies = { consume?: typeof consumeForUser; now?: () => Date };
export async function sendJobUpdate(db: PrismaClient, viewer: JobViewer, jobId: unknown, kind: unknown, lateMinutes?: unknown, deps: Dependencies = {}): Promise<JobUpdateResult> {
  if (viewer.role !== "TRADIE" || !z.uuid().safeParse(jobId).success) return { status: "forbidden" };
  if (typeof kind !== "string" || !Object.hasOwn(actions, kind) || (kind === "running-late" && ![15, 30, 60].includes(lateMinutes as number))) return { status: "invalid" };
  const id = jobId as string, action = actions[kind as keyof typeof actions];
  try {
    return await db.$transaction(async tx => {
      // Serialize duplicate sends and assignment/status changes using the existing schema-aware row lock.
      if (!await lockJobWindows(tx, id)) return { status: "forbidden" };
      const [person, job] = await Promise.all([
        tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } }),
        tx.job.findUnique({ where: { id }, select: { workerId: true, customerId: true, status: true, jobNumber: true } }),
      ]);
      if (person?.role !== "TRADIE" || job?.workerId !== viewer.userId || job.status !== "ASSIGNED") return { status: "forbidden" };
      const limit = await (deps.consume ?? consumeForUser)("message", viewer.userId);
      if (!limit.allowed) return { status: "try-later", retryAfter: limit.retryAfter };
      const now = (deps.now ?? (() => new Date()))();
      const previous = await tx.auditLog.findFirst({ where: { action, recordType: "jobs", recordId: id, actorId: viewer.userId, createdAt: { gte: new Date(now.getTime() - 120_000) } }, select: { id: true } });
      if (previous) return { status: "sent" };
      const payload = { jobId: id, jobNumber: job.jobNumber, ...(kind === "running-late" ? { lateMinutes: lateMinutes as number } : {}) };
      const audit = await createAudit(tx)(viewer, action, { type: "jobs", id }, null, payload);
      const recipients = kind === "customer-not-home" ? (await tx.profile.findMany({ where: { role: "ADMIN" }, select: { id: true } })).map(person => person.id) : [job.customerId];
      await createNotify(tx)(action, recipients, { eventId: `${audit.action}:${audit.id}`, payload });
      await tx.job.update({ where: { id }, data: { updatedAt: now } });
      return { status: "sent" };
    });
  } catch { return { status: "unavailable" }; }
}
