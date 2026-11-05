import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { CLAIM_FAILURE_COPY, type WorkerClaimResult, type WorkerClaimView } from "@/lib/worker-claim";
import { createAudit } from "@/server/audit/audit";
import { problemContactHref } from "@/server/messages/contact";
import { createNotify } from "@/server/notifications/notify";
import type { JobViewer } from "@/server/views";
import { applyTransition, JobTransitionError, TransitionPreconditionError } from "./status-machine";
import { loadWorkerClaim } from "./worker-claim-reader";

async function claimedResult(db: PrismaClient, viewer: JobViewer, job: WorkerClaimView): Promise<WorkerClaimResult> {
  let contactHref = `/messages?job=${encodeURIComponent(job.id)}`;
  try { contactHref = await problemContactHref(db, viewer, job.id); } catch { /* An optional contact lookup cannot undo a committed claim. */ }
  return { status: "claimed", job, contactHref };
}

/** The browser supplies only a job id; the canonical machine locks and rechecks every current claim fact. */
export async function claimWorkerJob(db: PrismaClient, viewer: JobViewer, id: unknown): Promise<WorkerClaimResult> {
  if (viewer.role !== "TRADIE") return { status: "ineligible", failure: "worker-required" };
  if (!z.uuid().safeParse(id).success) return { status: "ineligible", failure: "not-open" };
  const jobId = id as string;
  let claimed: WorkerClaimView;
  try {
    claimed = await db.$transaction(async tx => {
      let eventId = "";
      await applyTransition(tx, {
        audit: async (_tx, entry) => {
          const audit = await createAudit(tx)(viewer, "job.claimed", { type: "jobs", id: jobId }, entry.before, entry.after);
          eventId = `job.claimed:${audit.id}`;
        },
        notify: async (_tx, change) => {
          await createNotify(tx)("job.claimed", [change.customerId, viewer.userId], { eventId, payload: { jobId, jobNumber: change.jobNumber } });
        },
      }, { jobId, transition: "claim", actor: viewer });
      const current = await loadWorkerClaim(tx, viewer, jobId);
      if (!current?.job.assignedToYou) throw new Error("Claim projection unavailable");
      return current.job;
    });
  } catch (error) {
    if (error instanceof TransitionPreconditionError && Object.hasOwn(CLAIM_FAILURE_COPY, error.failure)) return { status: "ineligible", failure: error.failure as keyof typeof CLAIM_FAILURE_COPY };
    if (error instanceof JobTransitionError) {
      const current = await db.job.findUnique({ where: { id: jobId }, select: { status: true, workerId: true } });
      if (current?.status === "ASSIGNED" && current.workerId && current.workerId !== viewer.userId) return { status: "lost" };
      if (current?.status === "ASSIGNED" && current.workerId === viewer.userId) {
        const owned = await loadWorkerClaim(db, viewer, jobId);
        if (owned?.job.assignedToYou) return claimedResult(db, viewer, owned.job);
      }
      return { status: "ineligible", failure: "not-open" };
    }
    return { status: "unavailable" };
  }
  return claimedResult(db, viewer, claimed);
}
