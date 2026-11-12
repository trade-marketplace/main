import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { JobViewer } from "@/server/views";
import type { SignoffListData, SignoffResult, SignoffView } from "@/lib/office/signoff";
import { flagNote } from "@/lib/office/signoff";
import { TRADE_LABELS } from "@/lib/office-jobs";
import { parseQueueQuery, QUEUE_PAGE_SIZE } from "@/lib/office-queues";
import { createAudit } from "@/server/audit/audit";
import { createNotify } from "@/server/notifications/notify";
import { evidencePhotoUrls } from "@/server/jobs/evidence";
import { applyTransition } from "@/server/jobs/status-machine";
import { lockJobWindows } from "@/server/jobs/window-lock";
import { getUploadService } from "@/server/files/service";
import { readOfficeQueues } from "./queues";
const name = (person: { firstName: string; lastName: string | null } | null) => person ? [person.firstName, person.lastName].filter(Boolean).join(" ") : "—";
async function office(db: PrismaClient, viewer: JobViewer) { return viewer.role === "ADMIN" && (await db.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } }))?.role === "ADMIN"; }
export async function loadSignoffList(db: PrismaClient, viewer: JobViewer, page = "1"): Promise<SignoffListData | null> {
  if (!await office(db, viewer)) return null;
  const data = await readOfficeQueues(db, viewer, parseQueueQuery({ tab: "signoff", page }));
  const jobs = await db.job.findMany({ where: { id: { in: data.rows.map(row => row.jobId) }, status: "SUBMITTED" }, select: { id: true, jobNumber: true, title: true, worker: { select: { firstName: true, lastName: true } }, evidence: { select: { submittedAt: true, officeCheck: true } }, problems: { where: { status: "OPEN" }, select: { id: true } } } });
  if (jobs.length !== data.rows.length) throw Error("signoff-read-changed");
  const settings = await db.settings.findUniqueOrThrow({ where: { id: 1 }, select: { autoReleaseHours: true } });
  return { loadedAt: Date.now(), page: data.page, total: data.total, rows: data.rows.map(row => { const job = jobs.find(job => job.id === row.jobId)!; return { loadedAt: Date.now(), id: job.id, number: `TM-${job.jobNumber}`, title: job.title, worker: name(job.worker), sentAt: job.evidence?.submittedAt?.toISOString() ?? null, hours: settings.autoReleaseHours, problem: job.problems.length > 0, checked: job.evidence?.officeCheck === "APPROVED" }; }) };
}
export { QUEUE_PAGE_SIZE };
type FileLinks = { photos: typeof evidencePhotoUrls; document: (viewer: JobViewer, path: string) => Promise<{ url: string }> };
export async function loadSignoffReview(db: PrismaClient, viewer: JobViewer, jobId: string, links?: FileLinks): Promise<SignoffView | null> {
  if (!z.uuid().safeParse(jobId).success || !await office(db, viewer)) return null;
  const job = await db.job.findUnique({ where: { id: jobId }, include: { customer: { select: { firstName: true, lastName: true } }, worker: { select: { firstName: true, lastName: true } }, evidence: { include: { checkedBy: { select: { firstName: true, lastName: true } } } }, materials: true, problems: { where: { status: "OPEN" }, select: { id: true } } } });
  if (!job) return null;
  const [settings, audit] = await Promise.all([db.settings.findUniqueOrThrow({ where: { id: 1 }, select: { autoReleaseHours: true } }), db.auditLog.findFirst({ where: { action: "job.materials_reported", recordType: "jobs", recordId: jobId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { reason: true } })]);
  let filesUnavailable = false;
  async function document(path: string | null | undefined) { if (!path) return null; try { return (await (links?.document ?? getUploadService().documentUrl)(viewer, path)).url; } catch { filesUnavailable = true; return null; } }
  const [photos, cocUrl, receiptUrl] = await Promise.all([(links?.photos ?? evidencePhotoUrls)(db, viewer, jobId).catch(() => { filesUnavailable = true; return []; }), document(job.evidence?.cocPath), document(job.materials?.receiptPath)]);
  return { loadedAt: Date.now(), id: job.id, number: `TM-${job.jobNumber}`, title: job.title, worker: name(job.worker), trade: TRADE_LABELS[job.category], customer: name(job.customer), sentAt: job.evidence?.submittedAt?.toISOString() ?? null, hours: settings.autoReleaseHours, problem: job.problems.length > 0, checked: job.evidence?.officeCheck === "APPROVED", movedOn: job.status !== "SUBMITTED", revision: job.evidence?.updatedAt.toISOString() ?? null, cocNumber: job.evidence?.cocNumber ?? null, cocUrl, photos: photos ?? [], notes: job.evidence?.notes ?? null, declaration: job.evidence?.declaration ?? null, declaredAt: job.evidence?.declaredAt?.toISOString() ?? null, budgetCents: job.materials?.budgetCents ?? 0, spentCents: job.materials?.spentCents ?? null, receiptUrl, overBudgetReason: audit?.reason ?? null, checkedBy: name(job.evidence?.checkedBy ?? null), checkedAt: job.evidence?.checkedAt?.toISOString() ?? null, filesUnavailable };
}
async function checkEvidence(db: PrismaClient, viewer: JobViewer, jobId: unknown, revision: unknown, note?: unknown): Promise<SignoffResult> {
  if (viewer.role !== "ADMIN" || !z.uuid().safeParse(jobId).success) return { status: "forbidden" };
  const flag = note !== undefined, reason = flag ? flagNote(note) : null;
  if (flag && !reason) return { status: "invalid" };
  try { return await db.$transaction(async tx => {
    if (!await lockJobWindows(tx, jobId as string)) return { status: "forbidden" };
    const [person, job] = await Promise.all([tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } }), tx.job.findUnique({ where: { id: jobId as string }, include: { evidence: true } })]);
    if (person?.role !== "ADMIN" || !job) return { status: "forbidden" };
    if (job.status !== "SUBMITTED" || !job.evidence?.submittedAt) return { status: "moved-on" };
    if (!flag && job.evidence.officeCheck === "APPROVED") return { status: "approved" };
    if (typeof revision !== "string" || job.evidence.updatedAt.toISOString() !== revision) return { status: "changed" };
    const data = { officeCheck: flag ? "FLAGGED" as const : "APPROVED" as const, checkNote: reason, checkedById: viewer.userId, checkedAt: new Date() };
    const checked = await tx.completionEvidence.update({ where: { jobId: job.id }, data });
    if (!flag) {
      await createAudit(tx)(viewer, "evidence.approved", { type: "completion_evidence", id: job.id }, job.evidence, checked);
      return { status: "approved" };
    }
    // Schema 4 requires FLAGGED on the OLD row before submittedAt can be cleared.
    const draft = await tx.completionEvidence.update({ where: { jobId: job.id }, data: { submittedAt: null } });
    await applyTransition(tx, { audit: async (_tx, entry) => { await createAudit(tx)(viewer, "job.status_overridden", { type: "jobs", id: job.id }, entry.before, entry.after, reason!); }, notify: async () => {} }, { jobId: job.id, transition: "override", to: "ASSIGNED", workerId: job.workerId, reason: reason!, actor: viewer });
    const audit = await createAudit(tx)(viewer, "evidence.flagged", { type: "completion_evidence", id: job.id }, job.evidence, draft, reason!);
    if (job.workerId) await createNotify(tx)("job.evidence_flagged", [job.workerId], { eventId: `evidence.flagged:${audit.id}`, payload: { jobId: job.id, jobNumber: job.jobNumber } });
    return { status: "flagged" };
  }); } catch { return { status: "unavailable" }; }
}
export const approveEvidence = (db: PrismaClient, viewer: JobViewer, jobId: unknown, revision: unknown) => checkEvidence(db, viewer, jobId, revision);
export const flagEvidence = (db: PrismaClient, viewer: JobViewer, jobId: unknown, revision: unknown, note: unknown) => checkEvidence(db, viewer, jobId, revision, note ?? "");
