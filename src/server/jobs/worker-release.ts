import "server-only";

import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { bookedSoon, releaseInputSchema, type ReleaseResult } from "@/lib/worker-release";
import { createAudit } from "@/server/audit/audit";
import { createNotify } from "@/server/notifications/notify";
import type { JobViewer } from "@/server/views";
import { applyTransition, JobTransitionError, TransitionPreconditionError } from "./status-machine";
import { lockJobWindows } from "./window-lock";

const REPEAT_WINDOW_MS = 30 * 24 * 3_600_000;

/**
 * "Can't make it" (#147): the worker hands a claimed job back. Under the job's lock: the booked time and their
 * unsent finish-up draft go, the job goes back on the board, the customer is told, and the office is told when it was
 * booked for today or tomorrow or this is the worker's second hand-back in 30 days. Returns the storage paths of the
 * draft's files so the caller can tidy them after commit.
 */
export async function releaseJob(db: PrismaClient, viewer: JobViewer, id: unknown, input: unknown, now = new Date()): Promise<{ result: ReleaseResult; orphanPaths: { photos: string[]; documents: string[] } }> {
  const none = { photos: [], documents: [] };
  if (viewer.role !== "TRADIE" || !z.uuid().safeParse(id).success) return { result: { status: "forbidden" }, orphanPaths: none };
  const parsed = releaseInputSchema.safeParse(input);
  if (!parsed.success) return { result: { status: "invalid", message: parsed.error.issues[0]?.message ?? "Pick a reason." }, orphanPaths: none };
  const jobId = id as string, reason = parsed.data.note ? `${parsed.data.reason}: ${parsed.data.note}` : parsed.data.reason;
  try {
    return await db.$transaction(async tx => {
      if (!await lockJobWindows(tx, jobId)) return { result: { status: "forbidden" as const }, orphanPaths: none };
      const [person, job] = await Promise.all([
        tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } }),
        tx.job.findUnique({ where: { id: jobId }, select: { id: true, jobNumber: true, status: true, workerId: true, customerId: true, bookedDate: true,
          evidence: { select: { submittedAt: true, cocPath: true, photos: { select: { path: true } } } }, materials: { select: { receiptPath: true } } } }),
      ]);
      if (person?.role !== "TRADIE" || !job || job.workerId !== viewer.userId) return { result: { status: "forbidden" as const }, orphanPaths: none };
      if (job.status !== "ASSIGNED" || job.evidence?.submittedAt) return { result: { status: "changed" as const }, orphanPaths: none };
      const soon = bookedSoon(job.bookedDate, now);
      const earlier = await tx.auditLog.count({ where: { action: "job.released", actorId: viewer.userId, createdAt: { gte: new Date(now.getTime() - REPEAT_WINDOW_MS) } } });

      // Their unsent finish-up draft is theirs alone; the next tradie starts fresh.
      const orphanPaths = { photos: job.evidence?.photos.map(photo => photo.path) ?? [], documents: [job.evidence?.cocPath, job.materials?.receiptPath].filter((path): path is string => Boolean(path)) };
      if (job.evidence) await tx.completionEvidence.delete({ where: { jobId } });
      if (job.materials) await tx.jobMaterials.update({ where: { jobId }, data: { spentCents: null, spentAt: null, receiptPath: null } });
      await tx.job.update({ where: { id: jobId }, data: { bookedDate: null, bookedTime: null } });

      let eventId = "";
      await applyTransition(tx, {
        audit: async (_tx, entry) => {
          const audit = await createAudit(tx)(viewer, "job.released", { type: "jobs", id: jobId }, entry.before, { ...entry.after, bookedSoon: soon, repeat: earlier > 0 }, reason);
          eventId = `job.released:${audit.id}`;
        },
        notify: async () => {},
      }, { jobId, transition: "release", actor: viewer, reason });
      const payload = { jobId, jobNumber: job.jobNumber };
      await createNotify(tx)("job.released", [job.customerId], { eventId, payload });
      if (soon || earlier > 0) {
        const office = await tx.profile.findMany({ where: { role: "ADMIN" }, select: { id: true } });
        await createNotify(tx)("job.release_flagged", office.map(row => row.id), { eventId: `${eventId}:office`, payload });
      }
      return { result: { status: "released" as const }, orphanPaths };
    }, { timeout: 30_000 });
  } catch (error) {
    if (error instanceof TransitionPreconditionError && (error.failure === "extra-work-open" || error.failure === "extra-work-approved")) return { result: { status: "extra-work" }, orphanPaths: none };
    if (error instanceof JobTransitionError && error.code === "conflict") return { result: { status: "changed" }, orphanPaths: none };
    return { result: { status: "unavailable" }, orphanPaths: none };
  }
}
