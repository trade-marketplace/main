import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import type { JobStatus, Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Role } from "@/lib/mode";
import { normaliseMobile } from "@/lib/auth/signup";
import { jobNumberFromSearch, STATUS_GROUPS } from "@/lib/office-jobs";
import { QUEUE_PAGE_SIZE, waitingLabel, queueHref, type QueueData, type QueueKey, type QueueKpi, type QueueQuery, type QueueRow } from "@/lib/office-queues";
import { officeProblemJobHref } from "@/lib/office-problem";
import { getDb } from "@/server/db";
import { JOB_SUMMARY_SELECT, officeJobListView } from "@/server/views/jobs";
import type { JobViewer } from "@/server/views/access";
import { officeQueueJobView } from "@/server/views/office-queues";
import { variationPricingHref } from "@/lib/office-variation";
import { PRICE_SLOW_AFTER_HOURS, UNCLAIMED_AFTER_HOURS } from "@/server/scheduler/rules";

export type QueueDatabase = Pick<PrismaClient, "job" | "jobStatusHistory" | "variation" | "completionEvidence" | "problemReport" | "workerProfile" | "supportThread" | "settings" | "auditLog">;
const HOUR = 3_600_000;
const PRICE_STATUSES = [...STATUS_GROUPS.price.statuses];
const ACTIVE_EXTRA = { status: "REQUESTED", job: { status: { notIn: ["CANCELLED", "COMPLETED"] } } } satisfies Prisma.VariationWhereInput;
const PENDING_WORKERS = { verifiedAt: null, user: { role: "TRADIE" } } satisfies Prisma.WorkerProfileWhereInput;
export const QUEUE_JOB_SELECT = {
  ...JOB_SUMMARY_SELECT,
  customer: { select: { id: true, firstName: true, lastName: true } }, worker: { select: { id: true, firstName: true, lastName: true } },
  statusHistory: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
  estimates: { where: { madeBeforeEdit: false }, select: { minutes: true, materialsCents: true, needsSiteVisit: true, madeBeforeEdit: true } },
  evidence: { select: { submittedAt: true } }, problems: { where: { status: "OPEN" }, select: { id: true } },
} satisfies Prisma.JobSelect;
type SelectedJob = Prisma.JobGetPayload<{ select: typeof QUEUE_JOB_SELECT }>;

function requireOffice(viewer: JobViewer) { if (!viewer.userId || viewer.role !== "ADMIN") notFound(); }
/** Used by both the badge count and the actual queue query; a recent re-entry resets the unclaimed clock. */
export function queueJobWhere(tab: Exclude<QueueKey, "extra">, now: Date): Prisma.JobWhereInput {
  if (tab === "price") return { status: { in: PRICE_STATUSES } };
  if (tab === "cancel") return { status: "CANCEL_REVIEW" };
  if (tab === "signoff") return { status: "SUBMITTED" };
  const cutoff = new Date(now.getTime() - UNCLAIMED_AFTER_HOURS * HOUR);
  return { status: "BOOKABLE", workerId: null, statusHistory: { some: { toStatus: "BOOKABLE", createdAt: { lte: cutoff } }, none: { toStatus: "BOOKABLE", createdAt: { gt: cutoff } } } };
}

/** Search is office-only. Email/phone are predicates, never selected into the serialized result. */
export function queueSearchWhere(query: string): Prisma.JobWhereInput {
  const text = { contains: query, mode: "insensitive" } as const;
  const number = jobNumberFromSearch(query), mobile = normaliseMobile(query);
  const compact = query.replace(/[\s().-]/g, "");
  const phone = mobile ?? (/^(?:\+|00)?\d{3,}$/.test(compact) ? compact.replace(/^0064/, "+64").replace(/^0(?=2)/, "+64") : query);
  const person = { OR: [{ firstName: text }, { lastName: text }, { email: text }, { phone: { contains: phone, mode: "insensitive" } }] } satisfies Prisma.ProfileWhereInput;
  const names = query.split(/\s+/).filter(Boolean);
  return { OR: [...(number === null ? [] : [{ jobNumber: number }]), { title: text }, { suburb: text }, { customer: person }, { worker: person },
    ...(names.length > 1 ? [{ customer: { AND: names.map(name => ({ OR: [{ firstName: { contains: name, mode: "insensitive" as const } }, { lastName: { contains: name, mode: "insensitive" as const } }] })) } },
      { worker: { AND: names.map(name => ({ OR: [{ firstName: { contains: name, mode: "insensitive" as const } }, { lastName: { contains: name, mode: "insensitive" as const } }] })) } }] : [])] };
}

function oldestEntry(db: QueueDatabase, statuses: JobStatus[], where: Prisma.JobWhereInput) {
  return db.jobStatusHistory.groupBy({ by: ["jobId"], where: { toStatus: { in: statuses }, job: where }, _max: { createdAt: true }, orderBy: [{ _max: { createdAt: "asc" } }, { jobId: "asc" }], take: 1 });
}
function kpi(count: number, since: Date | null, now: Date, threshold: number, detail?: string): QueueKpi {
  return { count, oldestAt: since?.toISOString() ?? null, overdue: !!count && !!since && now.getTime() - since.getTime() >= threshold * HOUR,
    detail: detail ?? (since ? waitingLabel(since, now) === "new" ? "new" : `oldest ${waitingLabel(since, now)}` : "—") };
}
export async function readOfficeQueueStats(db: QueueDatabase, viewer: JobViewer, now = new Date()) {
  requireOffice(viewer);
  const price = queueJobWhere("price", now), cancel = queueJobWhere("cancel", now), unclaimed = queueJobWhere("unclaimed", now);
  const [groups, extra, priceAge, cancelAge, unclaimedAge, unclaimedCount, signoffAge, missingEvidenceAge, settings, tradies, support, problemCount] = await Promise.all([
    db.job.groupBy({ by: ["status"], _count: { _all: true } }),
    db.variation.aggregate({ where: ACTIVE_EXTRA, _count: { _all: true }, _min: { createdAt: true } }),
    oldestEntry(db, PRICE_STATUSES, price), oldestEntry(db, ["CANCEL_REVIEW"], cancel), oldestEntry(db, ["BOOKABLE"], unclaimed),
    db.job.count({ where: unclaimed }), db.completionEvidence.aggregate({ where: { job: { status: "SUBMITTED", problems: { none: { status: "OPEN" } } } }, _min: { submittedAt: true } }),
    oldestEntry(db, ["SUBMITTED"], { status: "SUBMITTED", problems: { none: { status: "OPEN" } }, OR: [{ evidence: { is: null } }, { evidence: { is: { submittedAt: null } } }] }),
    db.settings.findUniqueOrThrow({ where: { id: 1 }, select: { autoReleaseHours: true } }),
    db.workerProfile.count({ where: PENDING_WORKERS }), db.supportThread.count({ where: { status: "OPEN" } }),
    db.problemReport.count({ where: { status: "OPEN" } }),
  ]);
  const oldestUnclaimed = unclaimedCount > 0 && unclaimedAge[0] ? await db.job.findFirst({
    where: { AND: [unclaimed, { id: unclaimedAge[0].jobId }] }, select: JOB_SUMMARY_SELECT,
  }) : null;
  const unclaimedView = oldestUnclaimed ? officeJobListView(viewer, oldestUnclaimed) : null;
  if (unclaimedCount > 0 && !unclaimedView) throw new Error("queue-read-changed");
  const count = (...statuses: JobStatus[]) => groups.filter(row => statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);
  const nzDate = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  // Query a broad UTC range, then compare NZ calendar days: this stays correct across daylight-saving changes.
  const releases = await db.completionEvidence.findMany({ where: { job: { status: "SUBMITTED", problems: { none: { status: "OPEN" } } }, submittedAt: { gte: new Date(now.getTime() - (settings.autoReleaseHours + 26) * HOUR), lte: new Date(now.getTime() + (26 - settings.autoReleaseHours) * HOUR) } }, select: { submittedAt: true } });
  const releaseToday = releases.filter(row => row.submittedAt && nzDate(new Date(row.submittedAt.getTime() + settings.autoReleaseHours * HOUR)) === nzDate(now)).length;
  const signoffDates = [signoffAge._min.submittedAt, missingEvidenceAge[0]?._max.createdAt].filter((date): date is Date => !!date);
  const signoffOldest = signoffDates.length ? new Date(Math.min(...signoffDates.map(date => date.getTime()))) : null;
  const kpis = {
    price: kpi(count("REVIEW", "QUOTE_BOUNTY"), priceAge[0]?._max.createdAt ?? null, now, PRICE_SLOW_AFTER_HOURS),
    extra: kpi(extra._count._all, extra._min.createdAt, now, PRICE_SLOW_AFTER_HOURS),
    cancel: kpi(count("CANCEL_REVIEW"), cancelAge[0]?._max.createdAt ?? null, now, PRICE_SLOW_AFTER_HOURS),
    signoff: kpi(count("SUBMITTED"), signoffOldest, now, settings.autoReleaseHours, `${releaseToday} auto-release today`),
    unclaimed: kpi(unclaimedCount, unclaimedAge[0]?._max.createdAt ?? null, now, UNCLAIMED_AFTER_HOURS, unclaimedView?.suburb ?? "—"),
  } satisfies Record<QueueKey, QueueKpi>;
  const queueTasks = Object.values(kpis).reduce((sum, item) => sum + item.count, 0);
  return { kpis, things: queueTasks + problemCount, counts: { queues: queueTasks, tradies, support }, waitingCustomer: count("PRICED"), problemCount, autoReleaseHours: settings.autoReleaseHours,
    date: new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", weekday: "short", day: "numeric", month: "short" }).format(now) };
}

const cachedStats = cache((userId: string, role: Role) => readOfficeQueueStats(getDb(), { userId, role }));
/** Request-local sharing between the office shell and page; role/id come from the server guard. */
export const getOfficeQueueStats = (viewer: JobViewer) => { requireOffice(viewer); return cachedStats(viewer.userId, viewer.role); };

function rowView(viewer: JobViewer, job: SelectedJob, id: string, since: Date, tab: QueueKey, now: Date, context: string, releaseHours: number): QueueRow | null {
  const visible = officeQueueJobView(viewer, job); if (!visible) return null;
  const { estimateCount, ...base } = visible;
  const hours = tab === "unclaimed" ? UNCLAIMED_AFTER_HOURS : tab === "signoff" ? releaseHours : PRICE_SLOW_AFTER_HOURS;
  const action = tab === "price" && estimateCount > 0 && ["REVIEW", "QUOTE_BOUNTY"].includes(job.status) ? "Price it" : "Open";
  return { ...base, id, since: since.toISOString(), waiting: waitingLabel(since, now), overdue: now.getTime() - since.getTime() >= hours * HOUR,
    context, action, href: `/admin/jobs/${job.id}${action === "Price it" ? "/price" : ""}` };
}

export async function readOfficeQueues(db: QueueDatabase, viewer: JobViewer, query: QueueQuery, now = new Date(), stats?: Awaited<ReturnType<typeof readOfficeQueueStats>>): Promise<QueueData> {
  requireOffice(viewer);
  const current = stats ?? await readOfficeQueueStats(db, viewer, now);
  const search = query.q ? queueSearchWhere(query.q) : null;
  const total = search ? await db.job.count({ where: search }) : current.kpis[query.tab].count;
  const page = Math.min(query.page, Math.max(1, Math.ceil(total / QUEUE_PAGE_SIZE))), skip = (page - 1) * QUEUE_PAGE_SIZE;
  let rows: QueueRow[] = [];
  if (search) {
    const jobs = await db.job.findMany({ where: search, select: QUEUE_JOB_SELECT, orderBy: [{ jobNumber: "desc" }], skip, take: QUEUE_PAGE_SIZE });
    rows = jobs.flatMap(job => { const row = rowView(viewer, job, job.id, job.statusHistory[0]?.createdAt ?? job.createdAt, "unclaimed", now, "", current.autoReleaseHours); return row ? [{ ...row, overdue: false, action: "Open" as const, href: `/admin/jobs/${job.id}` }] : []; });
  } else if (query.tab === "extra") {
    const extras = await db.variation.findMany({ where: ACTIVE_EXTRA, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip, take: QUEUE_PAGE_SIZE, select: { id: true, description: true, createdAt: true, job: { select: QUEUE_JOB_SELECT } } });
    rows = extras.flatMap(extra => { const row = rowView(viewer, extra.job, extra.id, extra.createdAt, "extra", now, extra.description, current.autoReleaseHours); return row ? [{ ...row, action: "Price it" as const, href: variationPricingHref(extra.id, queueHref({ ...query, page })) }] : []; });
  } else if (query.tab === "signoff") {
    const missingEvidence = { status: "SUBMITTED", OR: [{ evidence: { is: null } }, { evidence: { is: { submittedAt: null } } }] } satisfies Prisma.JobWhereInput;
    // Merge only the first page-end items from each ordered stream before slicing the requested page.
    // This keeps an old office override ahead of newer evidence without loading all submitted jobs.
    const end = skip + QUEUE_PAGE_SIZE;
    const [submitted, fallbackEntries] = await Promise.all([
      db.job.findMany({ where: { status: "SUBMITTED", evidence: { is: { submittedAt: { not: null } } } }, select: QUEUE_JOB_SELECT,
        orderBy: [{ evidence: { submittedAt: "asc" } }, { id: "asc" }], take: end }),
      db.jobStatusHistory.groupBy({ by: ["jobId"], where: { toStatus: "SUBMITTED", job: missingEvidence }, _max: { createdAt: true },
        orderBy: [{ _max: { createdAt: "asc" } }, { jobId: "asc" }], take: end }),
    ]);
    const overrides = fallbackEntries.length ? await db.job.findMany({ where: { AND: [missingEvidence, { id: { in: fallbackEntries.map(entry => entry.jobId) } }] }, select: QUEUE_JOB_SELECT }) : [];
    const jobs = [...submitted, ...overrides].sort((a, b) => {
      const age = (job: SelectedJob) => job.evidence?.submittedAt ?? job.statusHistory[0]?.createdAt ?? job.createdAt;
      return age(a).getTime() - age(b).getTime() || a.id.localeCompare(b.id);
    }).slice(skip, end);
    rows = jobs.flatMap(job => {
      const sent = job.evidence?.submittedAt, due = sent ? new Date(sent.getTime() + current.autoReleaseHours * HOUR) : null;
      const context = job.problems.length ? "Problems" : due ? new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(due) : "—";
      const row = rowView(viewer, job, job.id, sent ?? job.statusHistory[0]?.createdAt ?? job.createdAt, "signoff", now, context, current.autoReleaseHours);
      return row ? [{ ...row, overdue: !job.problems.length && row.overdue }] : [];
    });
  } else {
    const where = queueJobWhere(query.tab, now), statuses: JobStatus[] = query.tab === "price" ? PRICE_STATUSES : query.tab === "cancel" ? ["CANCEL_REVIEW"] : ["BOOKABLE"];
    const entries = await db.jobStatusHistory.groupBy({ by: ["jobId"], where: { toStatus: { in: statuses }, job: where }, _max: { createdAt: true }, orderBy: [{ _max: { createdAt: "asc" } }, { jobId: "asc" }], skip, take: QUEUE_PAGE_SIZE });
    const jobs = entries.length ? await db.job.findMany({ where: { AND: [where, { id: { in: entries.map(row => row.jobId) } }] }, select: QUEUE_JOB_SELECT }) : [];
    const reasons = query.tab === "cancel" && jobs.length ? await db.auditLog.findMany({ where: { recordType: "jobs", recordId: { in: jobs.map(job => job.id) }, action: "job.cancel_requested" }, select: { recordId: true, reason: true, createdAt: true }, orderBy: { createdAt: "desc" } }) : [];
    rows = entries.flatMap(entry => {
      const job = jobs.find(row => row.id === entry.jobId); if (!job || !entry._max.createdAt) return [];
      const row = rowView(viewer, job, job.id, entry._max.createdAt, query.tab, now, reasons.find(item => item.recordId === job.id && item.createdAt >= entry._max.createdAt!)?.reason ?? "—", current.autoReleaseHours);
      return row ? [row] : [];
    });
  }
  // Do not turn an inconsistent read or a legacy row missing its required history into a reassuring all-clear.
  if (!search && rows.length !== Math.min(QUEUE_PAGE_SIZE, Math.max(0, total - skip))) throw new Error("queue-read-changed");
  const problemPage = Math.min(query.problemPage, Math.max(1, Math.ceil(current.problemCount / QUEUE_PAGE_SIZE)));
  const cases = await db.problemReport.findMany({ where: { status: "OPEN" }, orderBy: [{ urgent: "desc" }, { createdAt: "asc" }, { id: "asc" }], skip: (problemPage - 1) * QUEUE_PAGE_SIZE, take: QUEUE_PAGE_SIZE, select: { id: true, topic: true, urgent: true, createdAt: true, job: { select: JOB_SUMMARY_SELECT } } });
  const problems = cases.flatMap(problem => { const job = officeQueueJobView(viewer, problem.job); return job ? [{ id: problem.id, jobId: job.jobId, number: job.number, title: job.title, topic: `${problem.urgent ? "Urgent · " : ""}${problem.topic}`, since: problem.createdAt.toISOString(), reported: waitingLabel(problem.createdAt, now), href: officeProblemJobHref(job.jobId, problem.id, { label: "Problems", href: `${queueHref(query)}#queue-problems` }) }] : []; });
  return { kpis: current.kpis, things: current.things, counts: current.counts, waitingCustomer: current.waitingCustomer, date: current.date,
    problemCount: current.problemCount, problemPage, rows, total, page, problems };
}
