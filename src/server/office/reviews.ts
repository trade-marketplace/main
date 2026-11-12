import "server-only";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { moderationReason, reviewCustomerName, REVIEW_PAGE_SIZE, type ReviewsPage, type ReviewsQuery, type ReviewResult } from "@/lib/office/reviews";
import type { JobViewer } from "@/server/views";
import { databaseSchema } from "@/server/database-client";
import { createAudit } from "@/server/audit/audit";
import { jobNumberFromSearch } from "@/lib/office-jobs";
const name = (person: { firstName: string; lastName: string | null }) => [person.firstName, person.lastName].filter(Boolean).join(" ");
export function reviewSearch(q: string): Prisma.ReviewWhereInput {
  if (!q) return {};
  const terms = q.split(/\s+/).filter(Boolean), number = jobNumberFromSearch(q);
  const person = { AND: terms.map(term => ({ OR: [{ firstName: { contains: term, mode: "insensitive" as const } }, { lastName: { contains: term, mode: "insensitive" as const } }] })) };
  return { OR: [{ reviewer: person }, { worker: person }, ...(number === null ? [] : [{ job: { jobNumber: number } }])] };
}
export async function listReviews(db: PrismaClient, viewer: JobViewer, input: ReviewsQuery): Promise<ReviewsPage | null> {
  if (viewer.role !== "ADMIN" || (await db.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } }))?.role !== "ADMIN") return null;
  const [all, reported, hidden] = await Promise.all([db.review.count(), db.review.count({ where: { reportedAt: { not: null }, hiddenAt: null } }), db.review.count({ where: { hiddenAt: { not: null } } })]);
  const counts = { all, reported, hidden }, tab = input.tab ?? (reported > 0 ? "reported" : "all");
  const where: Prisma.ReviewWhereInput = { AND: [reviewSearch(input.q), tab === "reported" ? { reportedAt: { not: null }, hiddenAt: null } : tab === "hidden" ? { hiddenAt: { not: null } } : {}] };
  const total = await db.review.count({ where }), page = Math.min(input.page, Math.max(1, Math.ceil(total / REVIEW_PAGE_SIZE)));
  const rows = await db.review.findMany({ where, orderBy: tab === "reported" ? [{ reportedAt: "asc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * REVIEW_PAGE_SIZE, take: REVIEW_PAGE_SIZE,
    select: { id: true, createdAt: true, rating: true, tags: true, comment: true, reportedAt: true, reportReason: true, hiddenAt: true, hiddenReason: true,
      hiddenBy: { select: { firstName: true, lastName: true } }, reviewer: { select: { firstName: true, lastName: true } }, worker: { select: { firstName: true, lastName: true } }, job: { select: { id: true, jobNumber: true } } } });
  return { counts, total, query: { ...input, page, tab }, rows: rows.map(row => ({ id: row.id, createdAt: row.createdAt.toISOString(), rating: row.rating, tags: row.tags, comment: row.comment, customer: reviewCustomerName(row.reviewer), tradie: name(row.worker), jobId: row.job.id, number: `TM-${row.job.jobNumber}`, reportReason: row.reportedAt ? row.reportReason : null, hiddenAt: row.hiddenAt?.toISOString() ?? null, hiddenReason: row.hiddenReason, hiddenBy: row.hiddenBy ? name(row.hiddenBy) : null })) };
}
async function moderate(db: PrismaClient, viewer: JobViewer, id: unknown, hide: boolean, reason?: unknown): Promise<ReviewResult> {
  if (viewer.role !== "ADMIN" || !z.uuid().safeParse(id).success) return { status: "forbidden" };
  const note = hide ? moderationReason(reason) : null;
  if (hide && !note) return { status: "invalid" };
  const relation = `"${databaseSchema(db).replaceAll('"', '""')}".reviews`;
  try { return await db.$transaction(async tx => {
    await tx.$queryRawUnsafe(`SELECT id FROM ${relation} WHERE id = $1::uuid FOR UPDATE`, id as string);
    const [person, before] = await Promise.all([tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } }), tx.review.findUnique({ where: { id: id as string } })]);
    if (person?.role !== "ADMIN" || !before) return { status: "forbidden" };
    if (hide === Boolean(before.hiddenAt)) return { status: hide ? "hidden" : "shown" };
    const changed = await tx.review.updateMany({ where: { id: before.id, hiddenAt: hide ? null : { not: null } }, data: hide ? { hiddenAt: new Date(), hiddenReason: note, hiddenById: viewer.userId } : { hiddenAt: null, hiddenReason: null, hiddenById: null } });
    if (!changed.count) return { status: hide ? "hidden" : "shown" };
    const after = await tx.review.findUniqueOrThrow({ where: { id: before.id } });
    if (hide) await createAudit(tx)(viewer, "review.hidden", { type: "reviews", id: before.id }, before, after, note!);
    else await createAudit(tx)(viewer, "review.shown", { type: "reviews", id: before.id }, before, after);
    return { status: hide ? "hidden" : "shown" };
  }); } catch { return { status: "unavailable" }; }
}
export const hideReview = (db: PrismaClient, viewer: JobViewer, id: unknown, reason: unknown) => moderate(db, viewer, id, true, reason);
export const showReview = (db: PrismaClient, viewer: JobViewer, id: unknown) => moderate(db, viewer, id, false);
