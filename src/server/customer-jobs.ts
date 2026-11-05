import "server-only";

import { notFound } from "next/navigation";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { CUSTOMER_JOBS_PAGE_SIZE, customerJobAction, customerJobUpdated, type CustomerJobsData, type CustomerJobsQuery } from "@/lib/customer-jobs";
import { customerJobListView, JOB_SUMMARY_SELECT, type JobViewer } from "@/server/views";

export type CustomerJobsStore = Pick<PrismaClient, "job">;
const SELECT = { ...JOB_SUMMARY_SELECT,
  worker: { select: { id: true, firstName: true, lastName: true } },
  variations: { where: { status: "PRICED" }, select: { id: true }, take: 1 },
} satisfies Prisma.JobSelect;

const STATUSES = {
  active: ["REVIEW", "QUOTE_BOUNTY", "PRICED", "BOOKABLE", "ASSIGNED", "SUBMITTED", "CANCEL_REVIEW"],
  done: ["COMPLETED"], cancelled: ["CANCELLED"],
} as const;
const NEEDS_ACTION: Prisma.JobWhereInput = { OR: [{ status: { in: ["PRICED", "SUBMITTED"] } }, { status: "ASSIGNED", variations: { some: { status: "PRICED" } } }] };

export function customerJobsWhere(viewer: JobViewer, query: CustomerJobsQuery): Prisma.JobWhereInput {
  const number = /^(?:TM-)?0*(\d+)$/i.exec(query.q)?.[1];
  const jobNumber = number && Number.isSafeInteger(Number(number)) && Number(number) <= 2147483647 ? Number(number) : null;
  return { customerId: viewer.userId, status: { in: [...STATUSES[query.tab]] }, ...(query.q ? { OR: [
    { title: { contains: query.q, mode: "insensitive" as const } }, ...(jobNumber !== null ? [{ jobNumber }] : []),
  ] } : {}) };
}

/** Only owner-scoped reads; the centralized customer view is projected before any row is serialized. */
export async function listCustomerJobs(db: CustomerJobsStore, viewer: JobViewer, query: CustomerJobsQuery, now = new Date()): Promise<CustomerJobsData> {
  if (!viewer.userId || viewer.role !== "CUSTOMER") notFound();
  const [active, done, cancelled] = await Promise.all(["active", "done", "cancelled"].map(tab => db.job.count({ where: customerJobsWhere(viewer, { ...query, tab: tab as CustomerJobsQuery["tab"] }) })));
  const counts = { active, done, cancelled }, total = counts[query.tab];
  const page = Math.min(query.page, Math.max(1, Math.ceil(total / CUSTOMER_JOBS_PAGE_SIZE)));
  const skip = (page - 1) * CUSTOMER_JOBS_PAGE_SIZE, where = customerJobsWhere(viewer, query);
  const orderBy = [{ createdAt: "desc" as const }, { jobNumber: "desc" as const }];
  let rows: Prisma.JobGetPayload<{ select: typeof SELECT }>[];
  if (query.tab === "active") {
    const priority = { AND: [where, NEEDS_ACTION] }, other = { AND: [where, { NOT: NEEDS_ACTION }] };
    const priorityCount = await db.job.count({ where: priority });
    const first = skip < priorityCount ? await db.job.findMany({ where: priority, select: SELECT, orderBy, skip, take: CUSTOMER_JOBS_PAGE_SIZE }) : [];
    const rest = first.length < CUSTOMER_JOBS_PAGE_SIZE ? await db.job.findMany({ where: other, select: SELECT, orderBy, skip: Math.max(0, skip - priorityCount), take: CUSTOMER_JOBS_PAGE_SIZE - first.length }) : [];
    rows = [...first, ...rest];
  } else rows = await db.job.findMany({ where, select: SELECT, orderBy, skip, take: CUSTOMER_JOBS_PAGE_SIZE });
  return { counts, total, page, rows: rows.flatMap(row => {
    const safe = customerJobListView(viewer, row);
    if (!safe) return [];
    const tradie = safe.worker ? `${safe.worker.firstName}${safe.worker.lastInitial ? ` ${safe.worker.lastInitial}.` : ""}` : null;
    return [{ ...safe, action: customerJobAction(row.status, row.variations.length > 0), tradie, updated: customerJobUpdated(safe.updatedAt, now) }];
  }) };
}
