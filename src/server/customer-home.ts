import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { CATEGORIES } from "@/lib/cards";
import type { CustomerHomeData, HomeJob } from "@/lib/customer-home";
import { customerJobAction } from "@/lib/customer-jobs";
import { checkCoverage, type Coverage } from "@/lib/geo/coverage";
import { isPoint } from "@/lib/geo/distance";
import type { Viewer } from "@/server/auth/viewer";
import { customerJobListView, JOB_SUMMARY_SELECT } from "@/server/views/jobs";

const SELECT = {
  ...JOB_SUMMARY_SELECT,
  // A published variation needs a customer decision. A worker's unpriced request does not.
  variations: { where: { status: "PRICED" }, select: { id: true }, take: 1 },
} satisfies Prisma.JobSelect;
type Source = Prisma.JobGetPayload<{ select: typeof SELECT }>;
type Store = Pick<PrismaClient, "job" | "address" | "settings">;
const ACTIVE = ["REVIEW", "QUOTE_BOUNTY", "PRICED", "BOOKABLE", "ASSIGNED", "SUBMITTED", "CANCEL_REVIEW"] as const;
const NEEDS_ACTION: Prisma.JobWhereInput = { OR: [
  { status: { in: ["PRICED", "SUBMITTED"] } },
  { status: "ASSIGNED", variations: { some: { status: "PRICED" } } },
] };

/** Owner scoping is in every database query, and #95 is the only job projection crossing into the UI. */
export async function loadCustomerHome(db: Store, viewer: Viewer, coverage: Coverage): Promise<CustomerHomeData | null> {
  if (viewer.role !== "CUSTOMER" || !viewer.userId) return null;
  const own: Prisma.JobWhereInput = { customerId: viewer.userId };
  const needs: Prisma.JobWhereInput = { AND: [own, NEEDS_ACTION] };
  const progress: Prisma.JobWhereInput = { AND: [own, { status: { in: [...ACTIVE] } }, { NOT: NEEDS_ACTION }] };
  const orderBy = [{ updatedAt: "desc" as const }, { id: "desc" as const }];
  const [needsRows, progressRows, recentRows, needsYouCount, progressCount, address, settings] = await Promise.all([
    db.job.findMany({ where: needs, select: SELECT, orderBy, take: 3 }),
    db.job.findMany({ where: progress, select: SELECT, orderBy, take: 3 }),
    db.job.findMany({ where: { ...own, status: { in: ["COMPLETED", "CANCELLED"] } }, select: SELECT, orderBy, take: 2 }),
    db.job.count({ where: needs }), db.job.count({ where: progress }),
    db.address.findFirst({ where: { userId: viewer.userId, isDefault: true }, select: { suburb: true, city: true, lat: true, lng: true } }),
    db.settings.findUnique({ where: { id: 1 }, select: { enabledTrades: true } }),
  ]);
  const project = (rows: Source[]): HomeJob[] => rows.flatMap(row => {
    const safe = customerJobListView(viewer, row);
    return safe ? [{ ...safe, action: customerJobAction(row.status, row.variations.length > 0) }] : [];
  });
  const point = address && typeof address.lat === "number" && typeof address.lng === "number" && isPoint({ lat: address.lat, lng: address.lng }) ? { lat: address.lat, lng: address.lng } : null;
  const location = { label: address ? [address.suburb, address.city].filter(Boolean).join(", ") : "", point };
  return { firstName: viewer.firstName, coverage, location, outside: checkCoverage(coverage, point).status === "outside",
    categories: settings ? CATEGORIES.filter(category => settings.enabledTrades.includes(category.toUpperCase() as typeof settings.enabledTrades[number])) : [...CATEGORIES],
    needsYou: project(needsRows), inProgress: project(progressRows), recent: project(recentRows),
    counts: { needsYou: needsYouCount, inProgress: progressCount } };
}
