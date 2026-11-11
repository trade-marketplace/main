import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { signoffHoursLeft, signoffReviewSchema, type CustomerSignoff, type SignoffResult } from "@/lib/customer-signoff";
import { createAudit } from "@/server/audit/audit";
import { databaseSchema } from "@/server/database-client";
import { createSupabaseFileStore, DOCUMENT_BUCKET, PHOTO_BUCKET, SIGNED_URL_SECONDS } from "@/server/files/storage";
import { createNotify } from "@/server/notifications/notify";
import type { JobViewer } from "@/server/views";
import { applyTransition } from "./status-machine";

type SignFile = (bucket: string, path: string) => Promise<string>;
const signFile: SignFile = (bucket, path) => createSupabaseFileStore().signedUrl(bucket, path, SIGNED_URL_SECONDS);

/** Authorize the actual customer before reading private evidence or signing any storage path. */
export async function loadCustomerSignoff(db: Pick<PrismaClient, "job" | "settings">, viewer: JobViewer, jobId: string, sign: SignFile = signFile, now = new Date(), expectedWorkerId?: string): Promise<CustomerSignoff | null> {
  if (viewer.role !== "CUSTOMER" || !z.uuid().safeParse(jobId).success) return null;
  const job = await db.job.findFirst({ where: { id: jobId, customerId: viewer.userId, customer: { role: "CUSTOMER" }, workerId: expectedWorkerId, status: { in: ["SUBMITTED", "COMPLETED"] } },
    select: { status: true, workerId: true, evidence: { select: { workerId: true, cocNumber: true, cocPath: true, notes: true, submittedAt: true, photos: { orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, path: true } } } },
      problems: { where: { status: "OPEN" }, take: 1, select: { id: true } }, statusHistory: { where: { toStatus: "COMPLETED" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { changedById: true } } } });
  if (!job) return null;
  const settings = await db.settings.findUniqueOrThrow({ where: { id: 1 }, select: { autoReleaseHours: true } });
  const evidence = job.evidence?.submittedAt && job.evidence.workerId === job.workerId ? job.evidence : null;
  let failed = false;
  const link = async (bucket: string, path: string | null) => { if (!path) return null; try { return await sign(bucket, path); } catch { failed = true; return null; } };
  const [cocUrl, photos] = await Promise.all([
    link(DOCUMENT_BUCKET, evidence?.cocPath ?? null),
    Promise.all((evidence?.photos ?? []).map(async photo => ({ id: photo.id, url: await link(PHOTO_BUCKET, photo.path) }))),
  ]);
  const cocFileLabel = evidence?.cocPath?.endsWith(".pdf") ? "PDF" : evidence?.cocPath?.endsWith(".webp") ? "Photo" : "File";
  return { cocNumber: evidence?.cocNumber ?? null, cocUrl, cocFileLabel, photos, notes: evidence?.notes ?? null, submittedAt: evidence?.submittedAt?.toISOString() ?? null,
    hoursLeft: signoffHoursLeft(evidence?.submittedAt ?? null, settings.autoReleaseHours, now), releaseAt: evidence?.submittedAt ? new Date(evidence.submittedAt.getTime() + settings.autoReleaseHours * 3_600_000).toISOString() : null, problemOpen: job.problems.length > 0,
    autoCompleted: job.status === "COMPLETED" && job.statusHistory[0]?.changedById === null, filesUnavailable: failed || Boolean(evidence?.cocNumber && !cocUrl), filesRenewAfterMs: Math.max(1000, (SIGNED_URL_SECONDS - 30) * 1000) };
}

/** A stale page cannot complete another state; completion, optional review, audit and notification commit together. */
export async function signOffJob(db: PrismaClient, viewer: JobViewer, id: unknown, revision: unknown, review?: unknown): Promise<SignoffResult> {
  if (viewer.role !== "CUSTOMER" || !z.uuid().safeParse(id).success || typeof revision !== "string") return { status: "forbidden" };
  const parsed = signoffReviewSchema.optional().safeParse(review);
  if (!parsed.success) return { status: "invalid" };
  const jobId = id as string;
  try {
    const relation = `"${databaseSchema(db).replaceAll('"', '""')}".jobs`;
    return await db.$transaction(async tx => {
      await tx.$queryRawUnsafe(`SELECT id FROM ${relation} WHERE id = $1::uuid AND customer_id = $2::uuid FOR UPDATE`, jobId, viewer.userId);
      const profile = await tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } });
      const job = await tx.job.findFirst({ where: { id: jobId, customerId: viewer.userId }, select: { id: true, jobNumber: true, status: true, workerId: true, updatedAt: true } });
      if (!job || profile?.role !== "CUSTOMER") return { status: "forbidden" };
      if (job.status !== "SUBMITTED" || job.updatedAt.toISOString() !== revision || !job.workerId) return { status: "changed" };
      let eventId = "";
      await applyTransition(tx, {
        // The machine's sign-off action maps to the existing catalogue's completed entry.
        audit: async (_tx, entry) => { const audit = await createAudit(tx)(viewer, "job.completed", { type: "jobs", id: jobId }, entry.before, entry.after); eventId = `job.signed_off:${audit.id}`; },
        notify: async () => { await createNotify(tx)("job.signed_off", [job.workerId!], { eventId, payload: { jobId, jobNumber: job.jobNumber } }); },
      }, { jobId, transition: "sign-off", actor: viewer });
      if (parsed.data) {
        const posted = await tx.review.create({ data: { jobId, reviewerId: viewer.userId, workerId: job.workerId, rating: parsed.data.rating, tags: parsed.data.tags, comment: parsed.data.comment?.trim() || null } });
        await createAudit(tx)(viewer, "review.posted", { type: "reviews", id: posted.id }, null, { jobId, workerId: job.workerId, rating: posted.rating, tags: posted.tags, comment: posted.comment });
      }
      return { status: "signed-off" };
    });
  } catch { return { status: "unavailable" }; }
}
