import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { JobViewer } from "@/server/views";
import { signoffReviewSchema } from "@/lib/customer-signoff";
import type { CustomerReview, CustomerReviewResult, SavedCustomerReview } from "@/lib/customer-review";
import { createAudit } from "@/server/audit/audit";
import { databaseSchema } from "@/server/database-client";

const reviewSelect = { rating: true, tags: true, comment: true, editableUntil: true } as const;
const project = (row: { rating: number; tags: string[]; comment: string | null; editableUntil: Date }): SavedCustomerReview => ({ rating: row.rating, tags: row.tags, comment: row.comment, editableUntil: row.editableUntil.toISOString() });

export async function loadCustomerReview(db: Pick<PrismaClient, "job">, viewer: JobViewer, jobId: string): Promise<CustomerReview | null> {
  if (viewer.role !== "CUSTOMER" || !z.uuid().safeParse(jobId).success) return null;
  const job = await db.job.findFirst({ where: { id: jobId, customerId: viewer.userId, customer: { role: "CUSTOMER" }, status: "COMPLETED", workerId: { not: null } }, select: {
    worker: { select: { firstName: true } }, review: { select: { ...reviewSelect, reviewerId: true, worker: { select: { firstName: true } } } },
  } });
  if (!job?.worker || job.review && job.review.reviewerId !== viewer.userId) return null;
  return { workerFirstName: job.review?.worker.firstName || job.worker.firstName || "your tradie", review: job.review ? project(job.review) : null };
}

export async function saveReview(db: PrismaClient, viewer: JobViewer, id: unknown, input: unknown): Promise<CustomerReviewResult> {
  if (viewer.role !== "CUSTOMER" || !z.uuid().safeParse(id).success) return { status: "forbidden" };
  const jobId = id as string, parsed = signoffReviewSchema.safeParse(input);
  try {
    const relation = `"${databaseSchema(db).replaceAll('"', '""')}".jobs`;
    return await db.$transaction(async tx => {
      await tx.$queryRawUnsafe(`SELECT id FROM ${relation} WHERE id=$1::uuid AND customer_id=$2::uuid FOR UPDATE`, jobId, viewer.userId);
      const profile = await tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } });
      const job = await tx.job.findFirst({ where: { id: jobId, customerId: viewer.userId, status: "COMPLETED", workerId: { not: null } }, select: {
        workerId: true, worker: { select: { firstName: true } }, review: { select: { ...reviewSelect, id: true, reviewerId: true, worker: { select: { firstName: true } } } },
      } });
      if (profile?.role !== "CUSTOMER" || !job?.workerId || !job.worker || job.review && job.review.reviewerId !== viewer.userId) return { status: "forbidden" };
      if (!parsed.success) return { status: "invalid" };
      const existing = job.review;
      if (existing && existing.editableUntil.getTime() <= Date.now()) return { status: "locked" };
      const data = { rating: parsed.data.rating, tags: parsed.data.tags, comment: parsed.data.comment?.trim() || null };
      const workerFirstName = existing?.worker.firstName || job.worker.firstName || "your tradie";
      if (existing && existing.rating === data.rating && existing.comment === data.comment && JSON.stringify(existing.tags) === JSON.stringify(data.tags)) return { status: "saved", data: { workerFirstName, review: project(existing) } };
      const stored = existing
        ? await tx.review.update({ where: { id: existing.id }, data, select: { ...reviewSelect, id: true } })
        : await tx.review.create({ data: { jobId, reviewerId: viewer.userId, workerId: job.workerId, ...data }, select: { ...reviewSelect, id: true } });
      await createAudit(tx)(viewer, existing ? "review.edited" : "review.posted", { type: "reviews", id: stored.id }, existing ? { rating: existing.rating, tags: existing.tags, comment: existing.comment } : null, existing ? data : { jobId, workerId: job.workerId, ...data });
      return { status: "saved", data: { workerFirstName, review: project(stored) } };
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("reviews can be edited for 7 days")) return { status: "locked" };
    return { status: "unavailable" };
  }
}
