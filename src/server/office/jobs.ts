// The office "All jobs" list (#170): one database read for a page of jobs, their count and the cities to filter by,
// and the same filters again for Export CSV. Only the office calls these (the page and the export route check the
// role first). Office users see every job and its price; nothing here is for customers or tradies.
import "server-only";

import type { JobStatus, Prisma, PrismaClient, Trade } from "@/generated/prisma/client";
import { statusPill } from "@/lib/job-status";
import {
  DATE_RANGES,
  jobNumberFromSearch,
  jobNumberLabel,
  OFFICE_JOBS_EXPORT_LIMIT,
  OFFICE_JOBS_PAGE_SIZE,
  type OfficeJobsQuery,
  STATUS_GROUPS,
  TRADE_LABELS,
} from "@/lib/office-jobs";
import { getDb } from "@/server/db";

/** One row of the table, ready to show: the server formats names and times so the browser never re-computes them. */
export type OfficeJobRow = {
  id: string;
  /** "TM-1005". */
  number: string;
  title: string;
  trade: string;
  status: JobStatus;
  /** "Sarah T": first name and last initial. */
  customer: string;
  tradie: string | null;
  /** What the customer pays, incl GST. Null until priced. */
  priceCents: number | null;
  suburb: string;
  city: string;
  /** "5m ago", "26h ago", "3 days ago". */
  updated: string;
  updatedAt: string;
};

export type OfficeJobsPage = {
  rows: OfficeJobRow[];
  total: number;
  /** The page shown (a page past the end shows the last one). */
  page: number;
  /** Every city a job is in, for the Region filter. */
  regions: string[];
};

/** Just the parts of Prisma these reads use, so tests pass a fake and nothing connects to a database. */
export type OfficeJobsDatabase = {
  job: Pick<PrismaClient["job"], "findMany" | "count">;
};

const SELECT = {
  id: true,
  jobNumber: true,
  title: true,
  category: true,
  status: true,
  priceCents: true,
  suburb: true,
  city: true,
  updatedAt: true,
  customer: { select: { firstName: true, lastName: true } },
  worker: { select: { firstName: true, lastName: true } },
} satisfies Prisma.JobSelect;

type SelectedJob = Prisma.JobGetPayload<{ select: typeof SELECT }>;

/** "Sarah T": the first name and last initial, as the mockup's table shows people. */
export function shortName(person: { firstName: string; lastName: string | null } | null): string | null {
  if (!person) return null;
  const initial = person.lastName?.trim().charAt(0).toUpperCase();
  return initial ? `${person.firstName} ${initial}` : person.firstName;
}

/** How long since it changed: "Just now", "46m ago", "26h ago", "3 days ago". */
export function updatedLabel(updatedAt: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - updatedAt.getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h ago`;
  const days = Math.round(minutes / (24 * 60));
  return `${days} days ago`;
}

/** The database filter for the list's state. Exported for tests. */
export function officeJobsWhere(query: OfficeJobsQuery, now: Date): Prisma.JobWhereInput {
  const and: Prisma.JobWhereInput[] = [];
  const statuses = STATUS_GROUPS[query.status].statuses;
  if (statuses) and.push({ status: { in: [...statuses] } });
  if (query.trade !== "all") and.push({ category: query.trade });
  if (query.region !== "all") and.push({ city: { equals: query.region, mode: "insensitive" } });
  const days = DATE_RANGES[query.date].days;
  if (days !== null) and.push({ updatedAt: { gte: new Date(now.getTime() - days * 24 * 60 * 60_000) } });
  const q = query.q.trim();
  if (q) {
    const text = { contains: q, mode: "insensitive" } as const;
    const person = { OR: [{ firstName: text }, { lastName: text }] };
    const number = jobNumberFromSearch(q);
    and.push({
      OR: [
        ...(number !== null ? [{ jobNumber: number }] : []),
        { title: text },
        { suburb: text },
        { customer: person },
        { worker: person },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

/** The database order for a sort. Newest change first by default; ties fall back to the newest job number. */
export function officeJobsOrderBy(sort: OfficeJobsQuery["sort"]): Prisma.JobOrderByWithRelationInput[] {
  const tie: Prisma.JobOrderByWithRelationInput = { jobNumber: "desc" };
  if (!sort) return [{ updatedAt: "desc" }, tie];
  const direction = sort.direction;
  switch (sort.key) {
    case "job":
      return [{ title: direction }, tie];
    case "customer":
      return [{ customer: { firstName: direction } }, { customer: { lastName: direction } }, tie];
    case "tradie":
      return [{ worker: { firstName: direction } }, { worker: { lastName: direction } }, tie];
    case "price":
      return [{ priceCents: { sort: direction, nulls: "last" } }, tie];
    default:
      return [{ updatedAt: direction }, tie];
  }
}

function toRow(job: SelectedJob, now: Date): OfficeJobRow {
  return {
    id: job.id,
    number: jobNumberLabel(job.jobNumber),
    title: job.title,
    trade: TRADE_LABELS[job.category as Trade],
    status: job.status,
    customer: shortName(job.customer) ?? "",
    tradie: shortName(job.worker),
    priceCents: job.priceCents,
    suburb: job.suburb,
    city: job.city,
    updated: updatedLabel(job.updatedAt, now),
    updatedAt: job.updatedAt.toISOString(),
  };
}

/** Cities with at least one job, for the Region filter: distinct, tidied and sorted. */
async function regionsOf(db: OfficeJobsDatabase): Promise<string[]> {
  const rows = await db.job.findMany({ distinct: ["city"], select: { city: true }, orderBy: { city: "asc" } });
  const seen = new Map<string, string>();
  for (const { city } of rows) {
    const name = city.trim();
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Jobs in the sort's order, skip / take as findMany. Sorted by tradie, jobs nobody has claimed come last in both
 * directions, as unpriced jobs do for price. Postgres puts them first when descending and Prisma can't say otherwise
 * through a relation, so that sort reads the claimed jobs, then the rest.
 */
async function findJobs(db: OfficeJobsDatabase, where: Prisma.JobWhereInput, sort: OfficeJobsQuery["sort"], skip: number, take: number) {
  const orderBy = officeJobsOrderBy(sort);
  if (sort?.key !== "tradie") return db.job.findMany({ where, select: SELECT, orderBy, skip, take });
  const claimed = { AND: [where, { workerId: { not: null } }] };
  const first = await db.job.findMany({ where: claimed, select: SELECT, orderBy, skip, take });
  if (first.length >= take) return first;
  // Past the claimed jobs: skip whatever of the page's offset they didn't use.
  const rest = first.length > 0 ? 0 : Math.max(0, skip - (await db.job.count({ where: claimed })));
  const unclaimed = await db.job.findMany({ where: { AND: [where, { workerId: null }] }, select: SELECT, orderBy, skip: rest, take: take - first.length });
  return [...first, ...unclaimed];
}

/** A page of jobs for the list's state. A page past the end shows the last page. */
export async function listOfficeJobs(
  query: OfficeJobsQuery,
  { db = getDb(), now = new Date() }: { db?: OfficeJobsDatabase; now?: Date } = {},
): Promise<OfficeJobsPage> {
  const where = officeJobsWhere(query, now);
  const [total, regions] = await Promise.all([db.job.count({ where }), regionsOf(db)]);
  const lastPage = Math.max(1, Math.ceil(total / OFFICE_JOBS_PAGE_SIZE));
  const page = Math.min(query.page, lastPage);
  const jobs = await findJobs(db, where, query.sort, (page - 1) * OFFICE_JOBS_PAGE_SIZE, OFFICE_JOBS_PAGE_SIZE);
  return { rows: jobs.map((job) => toRow(job, now)), total, page, regions };
}

/** Every job matching the list's state (no paging), for Export CSV. At most OFFICE_JOBS_EXPORT_LIMIT rows. */
export async function exportOfficeJobs(
  query: OfficeJobsQuery,
  { db = getDb(), now = new Date() }: { db?: OfficeJobsDatabase; now?: Date } = {},
): Promise<{ rows: OfficeJobRow[]; truncated: boolean }> {
  const jobs = await findJobs(db, officeJobsWhere(query, now), query.sort, 0, OFFICE_JOBS_EXPORT_LIMIT + 1);
  const truncated = jobs.length > OFFICE_JOBS_EXPORT_LIMIT;
  return { rows: jobs.slice(0, OFFICE_JOBS_EXPORT_LIMIT).map((job) => toRow(job, now)), truncated };
}

const CSV_COLUMNS: [header: string, value: (row: OfficeJobRow) => string][] = [
  ["Job number", (row) => row.number],
  ["Title", (row) => row.title],
  ["Trade", (row) => row.trade],
  // The same words as the office's status pills.
  ["Status", (row) => statusPill(row.status, "office")?.label ?? row.status],
  ["Customer", (row) => row.customer],
  ["Tradie", (row) => row.tradie ?? ""],
  ["Price (NZD incl GST)", (row) => (row.priceCents === null ? "" : (row.priceCents / 100).toFixed(2))],
  ["Suburb", (row) => row.suburb],
  ["City", (row) => row.city],
  ["Updated", (row) => row.updatedAt],
];

/**
 * One CSV cell: quoted when it holds a comma, quote or line break. A cell a spreadsheet would run as a formula
 * (starting with = + - @, tab or carriage return) gets a leading apostrophe, so a job title can't run code in
 * whoever opens the export (CSV injection).
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The export file: a header row, then one row per job, CRLF line ends (what Excel expects). */
export function officeJobsCsv(rows: readonly OfficeJobRow[]): string {
  const lines = [CSV_COLUMNS.map(([header]) => csvCell(header)).join(",")];
  for (const row of rows) lines.push(CSV_COLUMNS.map(([, value]) => csvCell(value(row))).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
