import "server-only";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { customerProblemSchema, type CustomerProblemContext, type CustomerProblemReceipt, type CustomerProblemResult } from "@/lib/customer-problem";
import { createAudit } from "@/server/audit/audit";
import type { Viewer } from "@/server/auth/viewer";
import type { InspectableFileStore } from "@/server/files/storage";
import { currentRole, ProblemThreadError, requireSupportPhotosReady } from "@/server/messages/service";
import { createNotify } from "@/server/notifications/notify";
import { consumeForUser, type RateLimitDecision } from "@/server/rate-limit";
import { lockJobWindows } from "./window-lock";

type Actor = Pick<Viewer, "userId">;
type Deps = { rateLimit?: (id: string) => Promise<RateLimitDecision>; files?: Pick<InspectableFileStore, "exists">;
  notify?: (tx: Prisma.TransactionClient, reportId: string, job: CustomerProblemContext, urgent: boolean) => Promise<void> };
const JOB_SELECT = { id: true, customerId: true, jobNumber: true, title: true, status: true } as const;
const REPORT_SELECT = { id: true, jobId: true, reportedById: true, topic: true, details: true, urgent: true, status: true, _count: { select: { photos: true } } } as const;
type ReportRow = Prisma.ProblemReportGetPayload<{ select: typeof REPORT_SELECT }>;
function receipt(report: ReportRow, jobStatus: string): CustomerProblemReceipt {
  return { id: report.id, topic: report.topic, details: report.details, urgent: report.urgent, photoCount: report._count.photos,
    releasePaused: report.status === "OPEN" && jobStatus === "SUBMITTED" };
}

export async function loadCustomerProblem(db: PrismaClient, actor: Actor, jobId: string, reportId?: string) {
  if (!z.uuid().safeParse(jobId).success || await currentRole(db, actor) !== "CUSTOMER") return null;
  const job = await db.job.findFirst({ where: { id: jobId, customerId: actor.userId }, select: JOB_SELECT });
  if (!job) return null;
  let report: CustomerProblemReceipt | null = null;
  if (reportId) {
    if (!z.uuid().safeParse(reportId).success) return null;
    const row = await db.problemReport.findFirst({ where: { id: reportId, jobId, reportedById: actor.userId }, select: REPORT_SELECT });
    if (!row) return null;
    report = receipt(row, job.status);
  }
  return { job: { id: job.id, jobNumber: job.jobNumber, title: job.title }, report };
}

async function notifyOffice(tx: Prisma.TransactionClient, reportId: string, job: CustomerProblemContext, urgent: boolean) {
  const office = await tx.profile.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  await createNotify(tx)("problem_report.created", office.map(person => person.id), {
    eventId: `problem_report:${reportId}`, payload: { jobId: job.id, jobNumber: job.jobNumber, reportId, urgent },
  });
}

/** A report, its private office conversation, photos, audit and office flag commit together. */
export async function reportCustomerProblem(db: PrismaClient, actor: Actor, raw: unknown, deps: Deps = {}): Promise<CustomerProblemResult> {
  const parsed = customerProblemSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const rate = await (deps.rateLimit ?? (id => consumeForUser("message", id)))(actor.userId);
  if (!rate.allowed) return { ok: false, error: "try-later", retryAfter: rate.retryAfter };
  const data = parsed.data;
  try {
    const report = await db.$transaction(async tx => {
      if (await currentRole(tx, actor) !== "CUSTOMER" || !await tx.job.findFirst({ where: { id: data.jobId, customerId: actor.userId }, select: { id: true } })) throw new ProblemThreadError("forbidden");
      // Same row lock as auto-sign-off. The timer cannot read OPEN-report facts until this transaction ends.
      await lockJobWindows(tx, data.jobId);
      const job = await tx.job.findFirst({ where: { id: data.jobId, customerId: actor.userId }, select: JOB_SELECT });
      if (!job) throw new ProblemThreadError("forbidden");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`support.message:${data.requestKey}`}, 0))`;
      const old = await tx.supportMessage.findUnique({ where: { requestKey: data.requestKey }, include: { photos: { orderBy: { position: "asc" } }, thread: { include: { problemReport: { select: REPORT_SELECT } } } } });
      if (old) {
        const prior = old.thread.problemReport;
        if (old.authorId !== actor.userId || old.thread.userId !== actor.userId || !prior || prior.jobId !== job.id || prior.reportedById !== actor.userId) throw new ProblemThreadError("forbidden");
        if (prior.topic !== data.topic || prior.details !== data.details || prior.urgent !== data.urgent || JSON.stringify(old.photos.map(photo => photo.path)) !== JSON.stringify(data.photoPaths)) throw new ProblemThreadError("invalid");
        return receipt(prior, job.status);
      }
      await requireSupportPhotosReady(tx, data.photoPaths, actor, job.id, { files: deps.files });
      const created = await tx.problemReport.create({ data: { jobId: job.id, reportedById: actor.userId, topic: data.topic, details: data.details, urgent: data.urgent,
        photos: { create: data.photoPaths.map((path, position) => ({ path, position })) } }, select: REPORT_SELECT });
      const thread = await tx.supportThread.create({ data: { userId: actor.userId, jobId: job.id, problemReportId: created.id, jobParticipants: false,
        subject: `${data.urgent ? "Urgent · " : ""}${data.topic}`,
        messages: { create: { authorId: actor.userId, body: `${data.urgent ? "Urgent / safety\n\n" : ""}${data.details}`, requestKey: data.requestKey, photos: { create: data.photoPaths.map((path, position) => ({ path, position })) } } } } });
      await createAudit(tx)(actor, "problem_report.created", { type: "problem_reports", id: created.id }, null, { jobId: job.id, threadId: thread.id, urgent: data.urgent, photoCount: data.photoPaths.length });
      await (deps.notify ?? notifyOffice)(tx, created.id, job, data.urgent);
      return receipt(created, job.status);
    }, { timeout: 30_000 });
    return { ok: true, report };
  } catch (error) {
    if (error instanceof ProblemThreadError) return { ok: false, error: error.code };
    console.error("Problem report could not be saved.");
    return { ok: false, error: "unavailable" };
  }
}
