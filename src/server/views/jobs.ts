import "server-only";

import { notFound } from "next/navigation";
import type { JobStatus, Prisma, PrismaClient, TimeOfDay, Trade } from "@/generated/prisma/client";
import { isPoint, type Point } from "@/lib/geo/distance";
import { jobApproximatePin } from "@/server/geo/job-location";
import { redactContactDetails } from "@/lib/problem-threads";
import { canReadJob, isClaimedJob, workerHasPrivateAccess, WORKER_VISIBLE_STATUSES, type JobAccess, type JobViewer } from "./access";

const PERSON_SELECT = { id: true, firstName: true, lastName: true, phone: true, email: true } as const;

export const JOB_SUMMARY_SELECT = {
  id: true, jobNumber: true, title: true, category: true, status: true, customerId: true, workerId: true,
  suburb: true, city: true, priceCents: true, asap: true, createdAt: true, updatedAt: true,
} satisfies Prisma.JobSelect;

/** Shared list input. It stays on the server; role projections below are the only serialized result. */
export const JOB_LIST_SELECT = {
  ...JOB_SUMMARY_SELECT,
  lat: true, lng: true, approxLat: true, approxLng: true,
  pricing: { select: { workerGrossCents: true, holidayPayCents: true, gstCents: true } },
} satisfies Prisma.JobSelect;

export const JOB_DETAIL_SELECT = {
  ...JOB_LIST_SELECT,
  description: true, addressLine1: true, addressLine2: true, postcode: true, accessNotes: true,
  anyTime: true, bookedDate: true, bookedTime: true, photosNeedCheck: true,
  locationSource: true, coverage: true, locationNeedsCheck: true, editedAt: true,
  customer: { select: PERSON_SELECT }, worker: { select: PERSON_SELECT },
  pricing: { select: {
    workerRateCents: true, minMinutes: true, holidayPayBps: true, onCostBps: true, marginBps: true, gstBps: true,
    minutes: true, materialsCents: true, workerGrossCents: true, holidayPayCents: true, onCostCents: true,
    marginCents: true, gstCents: true, note: true, pricedById: true, pricedAt: true, updatedAt: true,
  } },
  photos: { select: { id: true, position: true }, orderBy: { position: "asc" } },
  timeWindows: { select: { date: true, timeOfDay: true }, orderBy: [{ date: "asc" }, { timeOfDay: "asc" }] },
  estimates: { select: { id: true, workerId: true, minutes: true, materialsCents: true, note: true, needsSiteVisit: true, madeBeforeEdit: true, createdAt: true, updatedAt: true } },
} satisfies Prisma.JobSelect;

export type JobSource = Prisma.JobGetPayload<{ select: typeof JOB_DETAIL_SELECT }>;
export type JobListSource = Prisma.JobGetPayload<{ select: typeof JOB_LIST_SELECT }>;
type Person = { id: string; firstName: string; lastName: string | null; phone?: string | null; email?: string };
type PointSource = { lat?: number | null; lng?: number | null; approxLat?: number | null; approxLng?: number | null };

/** A lean shape also usable by an existing narrowly selected checkout/job list. */
export type JobSummarySource = JobAccess & {
  id: string; jobNumber: number; title: string; status: JobStatus; category: Trade; suburb: string; city: string;
  priceCents?: number | null; asap: boolean; createdAt: Date; updatedAt: Date;
  customer?: Person; worker?: Person | null;
  pricing?: { workerGrossCents?: number; holidayPayCents?: number; gstCents?: number } | null;
} & PointSource;

function point(lat: number | null | undefined, lng: number | null | undefined): Point | null {
  return typeof lat === "number" && typeof lng === "number" && isPoint({ lat, lng }) ? { lat, lng } : null;
}

function summary(job: JobSummarySource) {
  return { id: job.id, jobNumber: job.jobNumber, title: job.title, category: job.category, status: job.status,
    suburb: job.suburb, city: job.city, asap: job.asap,
    createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString() };
}
function shortPerson(person: Person | null | undefined, phone: boolean) {
  return person ? { id: person.id, firstName: person.firstName, lastInitial: person.lastName?.trim().charAt(0) ?? null, phone: phone ? person.phone ?? null : null } : null;
}

export function customerJobListView(viewer: JobViewer | null, job: JobSummarySource) {
  if (viewer?.role !== "CUSTOMER" || !canReadJob(viewer, job)) return null;
  const published = !["REVIEW", "QUOTE_BOUNTY"].includes(job.status);
  return { ...summary(job), priceCents: published ? job.priceCents ?? null : null, gstCents: published ? job.pricing?.gstCents ?? null : null };
}

export function workerJobListView(viewer: JobViewer | null, job: JobSummarySource) {
  if (viewer?.role !== "TRADIE" || !canReadJob(viewer, job)) return null;
  const assignedToYou = workerHasPrivateAccess(viewer, job);
  const payable = assignedToYou || job.status === "BOOKABLE";
  const gross = job.pricing?.workerGrossCents, holiday = job.pricing?.holidayPayCents;
  return { ...summary(job), title: redactContactDetails(job.title, assignedToYou), assignedToYou, point: assignedToYou ? point(job.lat, job.lng) : jobApproximatePin(job),
    precision: assignedToYou ? "exact" as const : "approximate" as const,
    earnCents: payable && typeof gross === "number" && typeof holiday === "number" ? gross + holiday : null };
}

export function officeJobListView(viewer: JobViewer | null, job: JobSummarySource) {
  if (viewer?.role !== "ADMIN" || !canReadJob(viewer, job)) return null;
  return { ...summary(job), customerId: job.customerId, workerId: job.workerId, priceCents: job.priceCents ?? null,
    customer: job.customer ? { id: job.customer.id, firstName: job.customer.firstName, lastName: job.customer.lastName } : null,
    worker: job.worker ? { id: job.worker.id, firstName: job.worker.firstName, lastName: job.worker.lastName } : null };
}

/** Message threads keep their stricter current-participant rule; open-board access does not grant a conversation. */
export function jobThreadContextView(viewer: JobViewer, job: JobSummarySource) {
  if (viewer.role !== "ADMIN" && !(viewer.role === "CUSTOMER" && job.customerId === viewer.userId) && !(viewer.role === "TRADIE" && job.workerId === viewer.userId)) return null;
  const visible = viewer.role === "CUSTOMER" ? customerJobListView(viewer, job) : viewer.role === "TRADIE" ? workerJobListView(viewer, job) : officeJobListView(viewer, job);
  if (!visible) return null;
  return { id: visible.id, jobNumber: visible.jobNumber, title: visible.title, suburb: visible.suburb, status: visible.status,
    worker: job.worker && isClaimedJob(job) ? `${job.worker.firstName}${job.worker.lastName ? ` ${job.worker.lastName[0]}` : ""}` : null };
}

function address(job: JobSource) {
  return { line1: job.addressLine1, line2: job.addressLine2, postcode: job.postcode, accessNotes: job.accessNotes };
}
function windows(job: JobSource) {
  return job.timeWindows.map(window => ({ date: window.date.toISOString().slice(0, 10), timeOfDay: window.timeOfDay }));
}
function photos(job: JobSource) { return job.photos.map(photo => ({ id: photo.id, position: photo.position })); }

export function customerJobView(viewer: JobViewer | null, job: JobSource) {
  const list = customerJobListView(viewer, job);
  if (!list) return null;
  return { ...list, description: job.description, address: address(job), point: point(job.lat, job.lng),
    anyTime: job.anyTime, timeWindows: windows(job), bookedDate: job.bookedDate?.toISOString().slice(0, 10) ?? null,
    bookedTime: job.bookedTime, photos: photos(job), photosNeedCheck: job.photosNeedCheck,
    worker: shortPerson(job.worker, isClaimedJob(job)) };
}

export function workerJobView(viewer: JobViewer | null, job: JobSource) {
  const list = workerJobListView(viewer, job);
  if (!list) return null;
  const own = job.estimates.find(estimate => estimate.workerId === viewer!.userId);
  return { ...list, description: redactContactDetails(job.description, list.assignedToYou), address: list.assignedToYou ? address(job) : null,
    customer: list.assignedToYou ? shortPerson(job.customer, true) : null,
    anyTime: job.anyTime, timeWindows: windows(job), bookedDate: job.bookedDate?.toISOString().slice(0, 10) ?? null,
    bookedTime: job.bookedTime, photos: photos(job), ownEstimate: own ? { minutes: own.minutes, materialsCents: own.materialsCents, note: own.note, needsSiteVisit: own.needsSiteVisit, madeBeforeEdit: own.madeBeforeEdit } : null };
}

export function officeJobView(viewer: JobViewer | null, job: JobSource) {
  const list = officeJobListView(viewer, job);
  if (!list) return null;
  const p = job.pricing;
  const person = (row: Person | null) => row ? { id: row.id, firstName: row.firstName, lastName: row.lastName, email: row.email ?? null, phone: row.phone ?? null } : null;
  return { ...list, description: job.description, address: address(job), point: point(job.lat, job.lng), approximatePoint: jobApproximatePin(job),
    customer: person(job.customer), worker: person(job.worker), anyTime: job.anyTime, timeWindows: windows(job),
    bookedDate: job.bookedDate?.toISOString().slice(0, 10) ?? null, bookedTime: job.bookedTime, photos: photos(job),
    photosNeedCheck: job.photosNeedCheck, coverage: job.coverage, locationSource: job.locationSource, locationNeedsCheck: job.locationNeedsCheck,
    editedAt: job.editedAt?.toISOString() ?? null,
    pricing: p ? { workerRateCents: p.workerRateCents, minMinutes: p.minMinutes, holidayPayBps: p.holidayPayBps,
      onCostBps: p.onCostBps, marginBps: p.marginBps, gstBps: p.gstBps, minutes: p.minutes, materialsCents: p.materialsCents,
      workerGrossCents: p.workerGrossCents, holidayPayCents: p.holidayPayCents, onCostCents: p.onCostCents,
      marginCents: p.marginCents, gstCents: p.gstCents, note: p.note, pricedById: p.pricedById,
      pricedAt: p.pricedAt.toISOString(), updatedAt: p.updatedAt.toISOString() } : null,
    estimates: job.estimates.map(e => ({ id: e.id, workerId: e.workerId, minutes: e.minutes, materialsCents: e.materialsCents,
      note: e.note, needsSiteVisit: e.needsSiteVisit, madeBeforeEdit: e.madeBeforeEdit,
      createdAt: e.createdAt.toISOString(), updatedAt: e.updatedAt.toISOString() })) };
}

export function publicJobView(): null { return null; }

export type CustomerJobView = NonNullable<ReturnType<typeof customerJobView>>;
export type WorkerJobView = NonNullable<ReturnType<typeof workerJobView>>;
export type WorkerJobListView = NonNullable<ReturnType<typeof workerJobListView>>;
export type OfficeJobView = NonNullable<ReturnType<typeof officeJobView>>;

export function customerJobsView(viewer: JobViewer | null, jobs: readonly JobSummarySource[]) {
  return jobs.flatMap(job => { const visible = customerJobListView(viewer, job); return visible ? [visible] : []; });
}
export function workerJobsView(viewer: JobViewer | null, jobs: readonly JobSummarySource[]) {
  return jobs.flatMap(job => { const visible = workerJobListView(viewer, job); return visible ? [visible] : []; });
}
export function officeJobsView(viewer: JobViewer | null, jobs: readonly JobSummarySource[]) {
  return jobs.flatMap(job => { const visible = officeJobListView(viewer, job); return visible ? [visible] : []; });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Owner/publication scope is inside the query, so guessed foreign ids look exactly like missing ids. */
export function jobViewWhere(viewer: JobViewer): Prisma.JobWhereInput {
  if (!viewer.userId) return { id: { in: [] } };
  if (viewer.role === "ADMIN") return {};
  if (viewer.role === "CUSTOMER") return { customerId: viewer.userId };
  if (viewer.role === "TRADIE") return { OR: [{ workerId: viewer.userId }, { status: { in: [...WORKER_VISIBLE_STATUSES] } }] };
  return { id: { in: [] } };
}

export async function loadJobView(db: Pick<PrismaClient, "job">, viewer: JobViewer | null, id: string) {
  if (!viewer?.userId || !["ADMIN", "CUSTOMER", "TRADIE"].includes(viewer.role) || !UUID.test(id)) return null;
  const row = await db.job.findFirst({ where: { AND: [{ id }, jobViewWhere(viewer)] }, select: JOB_DETAIL_SELECT });
  if (!row) return null;
  return viewer.role === "ADMIN" ? officeJobView(viewer, row) : viewer.role === "CUSTOMER" ? customerJobView(viewer, row) : workerJobView(viewer, row);
}

/** Page/API readers must not distinguish a guessed foreign id from a missing job. */
export async function requireJobView(db: Pick<PrismaClient, "job">, viewer: JobViewer | null, id: string) {
  const view = await loadJobView(db, viewer, id);
  if (!view) notFound();
  return view;
}

// These wire fields are deliberately explicit so sibling screens consume projections, not ORM rows.
export type JobTimeWindowView = { date: string; timeOfDay: TimeOfDay };
