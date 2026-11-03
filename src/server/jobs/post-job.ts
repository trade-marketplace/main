import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { draftFieldErrors, jobDraftSchema, POST_KEY_SCHEMA, postJobSchema, type DraftFieldErrors, type JobDraft } from "@/lib/job-draft";
import { currentSchedule, postingDateRange } from "@/lib/job-time-windows";
export { postingDateRange } from "@/lib/job-time-windows";
import { canEstimate, WORKER_ELIGIBILITY_SELECT } from "@/server/workers/eligibility";
import { createAudit } from "@/server/audit/audit";
import type { Viewer } from "@/server/auth/viewer";
import { createSupabaseFileStore, PHOTO_BUCKET } from "@/server/files/storage";
import { loadCoverage, settingsCoverageSource } from "@/server/geo/coverage-settings";
import { resolveJobLocation } from "@/server/geo/job-location";
import { createNotify } from "@/server/notifications/notify";
import { enqueuePostConfirmation } from "@/server/notifications/post-confirmation";
import { consumeForUser, type RateLimitDecision } from "@/server/rate-limit";

import { ownsDraftPhoto } from "./draft-photos";
import { createJobInReview } from "./status-machine";

type Posted = { status: "posted"; jobId: string; jobNumber: number };
export type PostJobResult = Posted
  | { status: "needs-account" | "forbidden" | "photos-pending" | "trade-unavailable" | "draft-changed" }
  | { status: "invalid"; fields: DraftFieldErrors }
  | { status: "rate-limited"; retryAfter: number }
  | { status: "outside-area"; waitlist: { path: string; suburb: string; areaName: string; email: string } };

export type PostJobDeps = {
  photoExists?: (path: string) => Promise<boolean>;
  rateLimit?: (userId: string) => Promise<RateLimitDecision>;
  notifyWorkers?: (job: Posted) => Promise<void>;
  now?: () => Date;
  /** The wizard confirms its complete canonical checkpoint; existing #116 callers retain their contract. */
  expectedDraft?: { postKey: string; paths: readonly string[] };
};

/** Full posting command. All durable changes commit together; postKey retries never duplicate a job. */
export async function postJob(db: PrismaClient, viewer: Viewer | null, input: unknown, postKey: string, deps: PostJobDeps = {}): Promise<PostJobResult> {
  if (!viewer) return { status: "needs-account" };
  const key = POST_KEY_SCHEMA.safeParse(postKey);
  if (!key.success) return { status: "invalid", fields: { postKey: "Post it" } };
  postKey = key.data.toLowerCase();
  const now = (deps.now ?? (() => new Date()))();

  const result = await db.$transaction(async (tx): Promise<PostJobResult> => {
    // Serializes concurrent retries before any work; a hash collision merely makes unrelated posts wait.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`post:${postKey}`}, 0))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`draft:${viewer.userId}`}, 0))`;
    const customer = await tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true, emailVerifiedAt: true, email: true } });
    if (!customer) return { status: "needs-account" };
    if (customer.role !== "CUSTOMER") return { status: "forbidden" };
    if (!customer.emailVerifiedAt) return { status: "needs-account" };
    const previous = await tx.job.findUnique({ where: { postKey } });
    if (previous) return previous.customerId === viewer.userId
      ? { status: "posted", jobId: previous.id, jobNumber: previous.jobNumber }
      : { status: "forbidden" };

    let currentDraft: JobDraft | undefined;
    if (deps.expectedDraft) {
      const current = await tx.jobDraft.findUnique({ where: { profileId: viewer.userId } });
      const saved = jobDraftSchema.safeParse(current?.data);
      if (!saved.success || saved.data.postKey !== postKey || deps.expectedDraft.postKey !== postKey
        || JSON.stringify(saved.data.photoPaths ?? []) !== JSON.stringify(deps.expectedDraft.paths)) return { status: "draft-changed" };
      currentDraft = saved.data;
    }

    const parsed = postJobSchema.safeParse(input);
    if (!parsed.success) return { status: "invalid", fields: draftFieldErrors(parsed.error) };
    const data = parsed.data;
    if (data.postKey && data.postKey.toLowerCase() !== postKey) return { status: "invalid", fields: { postKey: "Post it" } };
    if (deps.expectedDraft && JSON.stringify(data.photoPaths) !== JSON.stringify(deps.expectedDraft.paths)) return { status: "photos-pending" };
    if (currentDraft) {
      const saved = postJobSchema.safeParse({ ...currentDraft, postKey, photoPaths: currentDraft.photoPaths ?? [], ...currentSchedule(currentDraft, now) });
      if (!saved.success || JSON.stringify(saved.data) !== JSON.stringify(postJobSchema.parse({ ...data, postKey }))) return { status: "draft-changed" };
    }
    const { today, last } = postingDateRange(now);
    if (data.timeWindows.some((w) => w.date < today || w.date > last)) {
      return { status: "invalid", fields: { timeWindows: "When do you need it?" } };
    }
    const rate = await (deps.rateLimit ?? ((id) => consumeForUser("postJob", id)))(viewer.userId);
    if (!rate.allowed) return { status: "rate-limited", retryAfter: rate.retryAfter };
    const availability = await tx.settings.findUnique({ where: { id: 1 }, select: { enabledTrades: true } });
    if (availability && !availability.enabledTrades.includes(data.category)) return { status: "trade-unavailable" };

    const coverage = await loadCoverage(settingsCoverageSource(() => tx));
    const location = resolveJobLocation(data.locationSource === "TYPED"
      ? { source: "TYPED", suburb: data.suburb }
      : { source: data.locationSource, suburb: data.suburb, point: data.point! }, coverage);
    if (!location.ok) return location.error === "outside-coverage"
      ? { status: "outside-area", waitlist: { ...location.waitlist, email: customer.email } }
      : { status: "invalid", fields: { point: "Address" } };

    if (data.photoPaths.some((path) => !ownsDraftPhoto(viewer.userId, postKey, path))) return { status: "photos-pending" };
    if (data.photoPaths.length && await tx.draftPhotoCleanup.count({ where: { path: { in: data.photoPaths }, deleting: true } })) return { status: "photos-pending" };
    const exists = deps.photoExists ?? ((path: string) => createSupabaseFileStore().exists(PHOTO_BUCKET, path));
    try {
      if (!(await Promise.all(data.photoPaths.map(exists))).every(Boolean)) return { status: "photos-pending" };
    } catch {
      return { status: "photos-pending" };
    }
    const job = await createJobInReview(tx, viewer.userId, {
      postKey, category: data.category, photosNeedCheck: data.photoPaths.length === 0,
      title: data.description.split("\n")[0].slice(0, 100), description: data.description,
      addressLine1: data.addressLine1, addressLine2: data.addressLine2,
      suburb: data.suburb, city: data.city, postcode: data.postcode,
      accessNotes: data.accessNotes, asap: data.asap, anyTime: data.anyTime,
      ...location.location,
    });
    await tx.jobPhoto.createMany({ data: data.photoPaths.map((path, position) => ({ jobId: job.id, path, position, uploadedById: viewer.userId })) });
    if (data.timeWindows.length) await tx.jobTimeWindow.createMany({ data: data.timeWindows.map((window) => ({ jobId: job.id, date: new Date(`${window.date}T00:00:00Z`), timeOfDay: window.timeOfDay })) });
    await tx.jobDraft.deleteMany({ where: { profileId: viewer.userId, data: { path: ["postKey"], equals: postKey } } });
    await createAudit(tx)(viewer, "job.posted", { type: "jobs", id: job.id }, null, { status: "REVIEW", category: job.category, photosNeedCheck: job.photosNeedCheck });
    await enqueuePostConfirmation(tx, { jobId: job.id, customerId: viewer.userId, recipientEmail: customer.email, jobNumber: job.jobNumber, title: job.title });
    return { status: "posted", jobId: job.id, jobNumber: job.jobNumber };
  }, { timeout: 20_000 });

  if (result.status === "posted") {
    // Deterministic event id also lets a successful retry recover a previous notification outage.
    try { await (deps.notifyWorkers ?? ((job) => notifyEligibleWorkers(db, job, now)))(result); }
    catch { console.error("Posted job worker notifications could not be delivered."); }
  }
  return result;
}

export async function notifyEligibleWorkers(db: PrismaClient, posted: Posted, now: Date) {
  const job = await db.job.findUniqueOrThrow({ where: { id: posted.jobId }, include: { timeWindows: { select: { date: true } } } });
  // A typed address needs the office to locate it before a work-area match can be made.
  if (job.status !== "REVIEW") return;
  const workers = await db.profile.findMany({
    where: { role: "TRADIE", workerProfile: { is: { available: true } } },
    select: WORKER_ELIGIBILITY_SELECT,
  });
  const settings = await db.settings.findUnique({ where: { id: 1 }, select: { enabledTrades: true } });
  const recipients = workers.filter(worker => canEstimate(worker, job, { now, ...(settings ? { enabledTrades: settings.enabledTrades } : {}) })).map(worker => worker.id);
  await createNotify(db)("job.posted", recipients, { eventId: `job.posted:${job.id}`, payload: { jobId: job.id, jobNumber: job.jobNumber, asap: job.asap } });
}
