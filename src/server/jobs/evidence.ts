import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { FINISH_DECLARATION, finishErrors, finishInputSchema, finishSpend, type FinishFields, type FinishResult, type FinishUploadResult, type FinishView } from "@/lib/finish-job";
import { createAudit } from "@/server/audit/audit";
import { createNotify } from "@/server/notifications/notify";
import { checkUpload, PHOTO_MAX_EDGE, toWebp } from "@/server/files/images";
import { MESSAGES, UploadError } from "@/server/files/errors";
import { getUploadService, type DocumentFolder } from "@/server/files/service";
import { createSupabaseFileStore, DOCUMENT_BUCKET, PHOTO_BUCKET, SIGNED_URL_SECONDS, type InspectableFileStore } from "@/server/files/storage";
import type { JobViewer } from "@/server/views";
import { applyTransition } from "./status-machine";
import { lockJobWindows } from "./window-lock";

type Deps = { store?: InspectableFileStore; document?: (viewer: JobViewer, folder: DocumentFolder, bytes: Uint8Array) => Promise<{ path: string }> };
const SELECT = { id: true, workerId: true, customerId: true, status: true, jobNumber: true, title: true, category: true,
  customer: { select: { firstName: true } }, materials: true, evidence: { include: { photos: { orderBy: [{ position: "asc" }, { id: "asc" }] } } },
  variations: { where: { status: { in: ["REQUESTED", "PRICED"] } }, select: { id: true }, take: 1 } } satisfies Prisma.JobSelect;
type Source = Prisma.JobGetPayload<{ select: typeof SELECT }>;
const storeFor = (deps: Deps) => deps.store ?? createSupabaseFileStore();
async function own(tx: Prisma.TransactionClient, viewer: JobViewer, jobId: string, write = false) {
  if (viewer.role !== "TRADIE") return null;
  if (write && !await lockJobWindows(tx, jobId)) return null;
  const [person, job] = await Promise.all([tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } }), tx.job.findUnique({ where: { id: jobId }, select: SELECT })]);
  if (person?.role !== "TRADIE" || job?.workerId !== viewer.userId || !["ASSIGNED", "SUBMITTED"].includes(job.status)) return null;
  if (write && (job.status !== "ASSIGNED" || job.evidence?.submittedAt)) return null;
  return job;
}
function fieldsOf(job: Source): FinishFields {
  return { cocNumber: job.evidence?.cocNumber ?? "", notes: job.evidence?.notes ?? "", spent: String((job.materials?.spentCents ?? 0) / 100), declaration: job.evidence?.declaration === FINISH_DECLARATION && Boolean(job.evidence.declaredAt), reason: "" };
}
function draftData(viewer: JobViewer, fields: FinishFields) {
  return { workerId: viewer.userId, cocNumber: fields.cocNumber.trim() || null, notes: fields.notes.trim() || null,
    declaration: fields.declaration ? FINISH_DECLARATION : null, declaredAt: fields.declaration ? new Date() : null };
}
function spendOf(job: Source, fields: FinishFields) { return (job.materials?.budgetCents ?? 0) > 0 ? finishSpend(fields.spent) : 0; }
async function saveSpend(tx: Prisma.TransactionClient, id: string, spentCents: number) {
  return tx.jobMaterials.upsert({ where: { jobId: id }, create: { jobId: id, budgetCents: 0, spentCents, spentAt: new Date() }, update: { spentCents, spentAt: new Date() } });
}
export async function loadFinish(db: PrismaClient, viewer: JobViewer, jobId: string, deps: Deps = {}): Promise<FinishView | null> {
  if (!z.uuid().safeParse(jobId).success || viewer.role !== "TRADIE") return null;
  const loaded = await db.$transaction(async tx => {
    const job = await own(tx, viewer, jobId); if (!job) return null;
    const [rule, settings, audit] = await Promise.all([
      tx.tradeEvidenceRule.findUnique({ where: { trade: job.category }, select: { cocRequired: true, cocFileRequired: true, minPhotos: true, notesRequired: true } }),
      tx.settings.findUnique({ where: { id: 1 }, select: { autoReleaseHours: true } }),
      job.evidence?.submittedAt ? tx.auditLog.findFirst({ where: { recordType: "jobs", recordId: jobId, action: "job.materials_reported", actorId: job.evidence.workerId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { reason: true } }) : null,
    ]);
    return { job, rule, settings, reason: audit?.reason ?? "" };
  });
  if (!loaded) return null;
  const { job, rule, settings, reason } = loaded;
  const sign = async (bucket: string, path: string) => storeFor(deps).signedUrl(bucket, path, SIGNED_URL_SECONDS);
  const photos = await Promise.all((job.evidence?.photos ?? []).map(async (photo, index) => ({ id: photo.id, src: await sign(PHOTO_BUCKET, photo.path), name: `Photo ${index + 1}` })));
  return { id: job.id, ownerId: viewer.userId, title: job.title, customerFirstName: job.customer.firstName, category: job.category, autoReleaseHours: settings?.autoReleaseHours ?? 48,
    rule, fields: { ...fieldsOf(job), reason }, photos, budgetCents: job.materials?.budgetCents ?? 0, extraWorkOpen: job.variations.length > 0, readOnly: job.status === "SUBMITTED" || Boolean(job.evidence?.submittedAt),
    cocDocument: job.evidence?.cocPath ? { url: await sign(DOCUMENT_BUCKET, job.evidence.cocPath), name: "CoC document" } : null,
    receipt: job.materials?.receiptPath ? { url: await sign(DOCUMENT_BUCKET, job.materials.receiptPath), name: "Receipt" } : null };
}
export async function saveDraft(db: PrismaClient, viewer: JobViewer, jobId: unknown, input: unknown): Promise<FinishResult> {
  if (viewer.role !== "TRADIE" || !z.uuid().safeParse(jobId).success) return { status: "forbidden" };
  const parsed = finishInputSchema.safeParse(input); if (!parsed.success) return { status: "invalid", fields: { form: "Check the form and try again." } };
  try { return await db.$transaction(async tx => {
    const job = await own(tx, viewer, jobId as string, true); if (!job) return { status: "forbidden" };
    const spent = spendOf(job, parsed.data); if (spent === null) return { status: "invalid", fields: { spent: "Enter the materials spend as $0 or more." } };
    await tx.completionEvidence.upsert({ where: { jobId: job.id }, create: { jobId: job.id, ...draftData(viewer, parsed.data) }, update: draftData(viewer, parsed.data) });
    await saveSpend(tx, job.id, spent);
    return { status: "saved" };
  }); } catch { return { status: "unavailable" }; }
}
export async function sendForSignOff(db: PrismaClient, viewer: JobViewer, jobId: unknown, input?: unknown, deps: Deps = {}): Promise<FinishResult> {
  if (viewer.role !== "TRADIE" || !z.uuid().safeParse(jobId).success) return { status: "forbidden" };
  try { return await db.$transaction(async tx => {
    // The same lock as draft/upload commands makes repeated sends and edits serialize.
    if (!await lockJobWindows(tx, jobId as string)) return { status: "forbidden" };
    const job = await own(tx, viewer, jobId as string); if (!job) return { status: "forbidden" };
    if (job.status === "SUBMITTED") return { status: "sent" };
    if (job.evidence?.submittedAt) return { status: "forbidden" };
    const parsed = finishInputSchema.safeParse(input ?? fieldsOf(job));
    if (!parsed.success) return { status: "invalid", fields: { form: "Check the form and try again." } };
    const fields = parsed.data, rule = await tx.tradeEvidenceRule.findUnique({ where: { trade: job.category } });
    const errors = finishErrors(fields, { rule, photoCount: job.evidence?.photos.length ?? 0, cocFile: Boolean(job.evidence?.cocPath), receipt: Boolean(job.materials?.receiptPath), budgetCents: job.materials?.budgetCents ?? 0, category: job.category, extraWorkOpen: job.variations.length > 0 });
    if (Object.keys(errors).length) return { status: "invalid", fields: errors };
    const fileStore = job.evidence?.photos.length || job.evidence?.cocPath || job.materials?.receiptPath ? storeFor(deps) : null;
    if (fileStore) {
      for (const photo of job.evidence?.photos ?? []) if (!await fileStore.exists(PHOTO_BUCKET, photo.path)) errors.photos = "A photo couldn’t be loaded. Try uploading it again.";
      if (job.evidence?.cocPath && !await fileStore.exists(DOCUMENT_BUCKET, job.evidence.cocPath)) errors.cocDocument = "The CoC document couldn’t be loaded. Try uploading it again.";
      if (job.materials?.receiptPath && !await fileStore.exists(DOCUMENT_BUCKET, job.materials.receiptPath)) errors.receipt = "The receipt couldn’t be loaded. Try uploading it again.";
      if (Object.keys(errors).length) return { status: "invalid", fields: errors };
    }
    const spentCents = spendOf(job, fields)!, budget = job.materials?.budgetCents ?? 0, over = spentCents > budget;
    const materials = await saveSpend(tx, job.id, spentCents);
    const materialsAudit = await createAudit(tx)(viewer, "job.materials_reported", { type: "jobs", id: job.id }, job.materials ? { spentCents: job.materials.spentCents, spentAt: job.materials.spentAt } : null, { spentCents: materials.spentCents, spentAt: materials.spentAt }, over ? fields.reason.trim() : null);
    await tx.completionEvidence.upsert({ where: { jobId: job.id }, create: { jobId: job.id, ...draftData(viewer, fields), cocPath: job.evidence?.cocPath ?? null, submittedAt: new Date() }, update: { ...draftData(viewer, fields), submittedAt: new Date() } });
    let submittedEventId = "";
    const change = await applyTransition(tx, { audit: async (_tx, entry) => {
      const audit = await createAudit(tx)(viewer, "job.submitted", { type: "jobs", id: job.id }, entry.before, entry.after);
      submittedEventId = `${audit.action}:${audit.id}`;
    }, notify: async () => {} }, { jobId: job.id, transition: "submit", actor: viewer });
    await createNotify(tx)("job.submitted", [change.customerId], { eventId: submittedEventId, payload: { jobId: job.id, jobNumber: job.jobNumber } });
    if (over) await createNotify(tx)("job.materials_over_budget", (await tx.profile.findMany({ where: { role: "ADMIN" }, select: { id: true } })).map(person => person.id), { eventId: `job.materials_over_budget:${materialsAudit.id}`, payload: { jobId: job.id, jobNumber: job.jobNumber } });
    return { status: "sent" };
  }, { timeout: 30_000 }); } catch { return { status: "unavailable" }; }
}

/** File reads reuse current job ownership, without opening the evidence to public-board viewers. */
export async function evidencePhotoUrls(db: PrismaClient, viewer: JobViewer, jobId: string, deps: Deps = {}) {
  if (!z.uuid().safeParse(jobId).success) return null;
  const source = await db.$transaction(async tx => {
    const [person, job] = await Promise.all([tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } }), tx.job.findUnique({ where: { id: jobId }, select: { customerId: true, workerId: true, status: true, evidence: { select: { submittedAt: true, photos: { select: { id: true, path: true }, orderBy: { position: "asc" } } } } } })]);
    if (person?.role !== viewer.role || !job || !(viewer.role === "ADMIN" || viewer.role === "CUSTOMER" && job.customerId === viewer.userId && Boolean(job.evidence?.submittedAt) || viewer.role === "TRADIE" && job.workerId === viewer.userId && ["ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW"].includes(job.status))) return null;
    return job.evidence?.photos ?? [];
  });
  if (!source) return null;
  return Promise.all(source.map(async photo => ({ id: photo.id, url: await storeFor(deps).signedUrl(PHOTO_BUCKET, photo.path, SIGNED_URL_SECONDS) })));
}
export async function addEvidencePhoto(db: PrismaClient, viewer: JobViewer, jobId: unknown, bytes: Uint8Array, requestId: unknown = randomUUID(), deps: Deps = {}): Promise<FinishUploadResult> {
  if (viewer.role !== "TRADIE" || !z.uuid().safeParse(jobId).success || !z.uuid().safeParse(requestId).success) return { status: "forbidden" };
  let uploaded: { store: InspectableFileStore; path: string } | null = null;
  try {
    const authorized = await db.$transaction(tx => own(tx, viewer, jobId as string)); if (authorized?.status !== "ASSIGNED" || authorized.evidence?.submittedAt) return { status: "forbidden" };
    const kind = checkUpload(bytes, ["jpeg", "png", "heic"], MESSAGES.photoType), file = await toWebp(bytes, kind, PHOTO_MAX_EDGE);
    const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 32), path = `evidence/${jobId}/${randomUUID()}-${digest}.webp`, storage = storeFor(deps);
    const result = await db.$transaction(async tx => {
      const job = await own(tx, viewer, jobId as string, true); if (!job) return { status: "forbidden" } as const;
      const previous = job.evidence?.photos.find(photo => photo.id === requestId);
      if (previous) return previous.path.endsWith(`-${digest}.webp`) ? { status: "uploaded", file: { id: previous.id, url: await storage.signedUrl(PHOTO_BUCKET, previous.path, SIGNED_URL_SECONDS), name: "Photo", size: bytes.length } } as const : { status: "invalid", message: "Choose the photo again." } as const;
      if ((job.evidence?.photos.length ?? 0) >= 10) return { status: "invalid", message: "Add up to 10 photos." } as const;
      await storage.put(PHOTO_BUCKET, path, file.bytes, file.contentType); uploaded = { store: storage, path };
      await tx.completionEvidence.upsert({ where: { jobId: job.id }, create: { jobId: job.id, workerId: viewer.userId }, update: {} });
      const photo = await tx.completionEvidencePhoto.create({ data: { id: requestId as string, jobId: job.id, path, position: Math.max(-1, ...(job.evidence?.photos.map(photo => photo.position) ?? [])) + 1 } });
      return { status: "uploaded", file: { id: photo.id, url: await storage.signedUrl(PHOTO_BUCKET, path, SIGNED_URL_SECONDS), name: "Photo", size: bytes.length } } as const;
    }, { timeout: 30_000 });
    return result;
  } catch (error) {
    if (uploaded) { const orphan = uploaded as { store: InspectableFileStore; path: string }; try { await orphan.store.remove(PHOTO_BUCKET, [orphan.path]); } catch { /* Never expose private orphan URLs. */ } }
    return error instanceof UploadError ? { status: "invalid", message: error.message } : { status: "unavailable" };
  }
}
export async function removeEvidencePhoto(db: PrismaClient, viewer: JobViewer, jobId: unknown, photoId: unknown, deps: Deps = {}): Promise<FinishResult> {
  if (viewer.role !== "TRADIE" || !z.uuid().safeParse(jobId).success || !z.uuid().safeParse(photoId).success) return { status: "forbidden" };
  try {
    const removed = await db.$transaction(async tx => {
      const job = await own(tx, viewer, jobId as string, true); if (!job) return null;
      const photo = job.evidence?.photos.find(photo => photo.id === photoId);
      if (!photo) return "";
      await tx.completionEvidencePhoto.delete({ where: { id: photo.id } });
      return photo.path;
    });
    if (removed === null) return { status: "forbidden" };
    if (removed) try { await storeFor(deps).remove(PHOTO_BUCKET, [removed]); } catch { /* The draft removal committed; private cleanup can be retried separately. */ }
    return { status: "saved" };
  } catch { return { status: "unavailable" }; }
}
export async function addEvidenceDocument(db: PrismaClient, viewer: JobViewer, jobId: unknown, kind: "coc" | "receipt", bytes: Uint8Array, deps: Deps = {}): Promise<FinishUploadResult> {
  if (viewer.role !== "TRADIE" || !z.uuid().safeParse(jobId).success) return { status: "forbidden" };
  try { return await db.$transaction(async tx => {
    const job = await own(tx, viewer, jobId as string, true); if (!job) return { status: "forbidden" };
    if (kind === "receipt" && (job.category === "ELECTRICAL" || (job.materials?.budgetCents ?? 0) <= 0)) return { status: "invalid", message: "This job doesn’t need a receipt." };
    const document = await (deps.document ?? ((who, folder, data) => getUploadService().addDocument(who, folder, data)))(viewer, kind === "receipt" ? "receipts" : "coc", bytes);
    if (kind === "coc") await tx.completionEvidence.upsert({ where: { jobId: job.id }, create: { jobId: job.id, workerId: viewer.userId, cocPath: document.path }, update: { cocPath: document.path } });
    else await tx.jobMaterials.update({ where: { jobId: job.id }, data: { receiptPath: document.path } });
    return { status: "uploaded", file: { id: kind, url: await storeFor(deps).signedUrl(DOCUMENT_BUCKET, document.path, SIGNED_URL_SECONDS), name: kind === "coc" ? "CoC document" : "Receipt", size: bytes.length } };
  }, { timeout: 30_000 }); } catch (error) { return error instanceof UploadError ? { status: "invalid", message: error.message } : { status: "unavailable" }; }
}
