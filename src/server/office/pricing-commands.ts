import "server-only";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { JobViewer } from "@/server/views";
import { PRICING_MESSAGES, UUID, type PricingFailure, type PublishResult, type PreviewResult } from "@/lib/office-pricing";
import { createAudit } from "@/server/audit/audit";
import { applyTransition, type Tx } from "@/server/jobs/status-machine";
import { createNotify } from "@/server/notifications/notify";
import { priceJob } from "@/server/pricing/price-job";
import { canPublishPrice, loadPricingSource, previewPrice, pricingRates, readPriceFields, requirePricingOffice, type PricingDatabase } from "./pricing-read";

type Db = Pick<PrismaClient, "$transaction">;
const failure = (error: PricingFailure["error"]): PricingFailure => ({ ok: false, error, message: PRICING_MESSAGES[error] });
class Refusal extends Error { constructor(readonly result: PricingFailure) { super("pricing-refused"); } }
class Replayed extends Error {}
function record(raw: unknown) { return raw && typeof raw === "object" ? raw as Record<string, unknown> : {}; }
export async function readOfficePricePreview(db: PricingDatabase, viewer: JobViewer, raw: unknown): Promise<PreviewResult> {
  requirePricingOffice(viewer);
  const data = record(raw), id = typeof data.jobId === "string" ? data.jobId : "";
  const parsed = readPriceFields(data); if (!parsed.ok) return parsed;
  const job = await loadPricingSource(db, viewer, id); if (!job) return failure("not-found");
  if (!canPublishPrice(job.status)) return failure("frozen");
  const preview = previewPrice(job, parsed.fields, await pricingRates(db, job));
  return "ok" in preview ? preview : { ok: true, preview };
}
async function lock(tx: Tx, viewer: JobViewer, id: string) {
  await tx.$queryRaw`SELECT set_config('app.actor_id', ${viewer.userId}, true)`;
  // Use the same adapter/schema-aware row lock as existing office mutations. Every refusal/replay throws,
  // so that lock write also rolls back: frozen jobs and idempotent retries do not change any record.
  const result = await tx.job.updateMany({ where: { id }, data: { updatedAt: new Date() } });
  if (result.count !== 1) throw new Refusal(failure("not-found"));
  // Match officeUsers()' capability lock and hold it through commit. A normal removal either finishes
  // before this fresh role read, or waits until this already-authorized transaction has committed.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(178, 1)`;
  const actor = await tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } });
  if (actor?.role !== "ADMIN") throw new Refusal(failure("forbidden"));
  const job = await loadPricingSource(tx, viewer, id); if (!job) throw new Refusal(failure("not-found"));
  return job;
}
async function command(db: Db, work: (tx: Tx) => Promise<void>): Promise<PublishResult> {
  try { await db.$transaction(work); return { ok: true }; }
  catch (error) {
    if (error instanceof Replayed) return { ok: true };
    if (error instanceof Refusal) return error.result;
    console.error("Office pricing: the action failed and was rolled back.");
    return failure("unavailable");
  }
}
export async function publishOfficePrice(db: Db, viewer: JobViewer, raw: unknown): Promise<PublishResult> {
  requirePricingOffice(viewer);
  const data = record(raw), id = typeof data.jobId === "string" ? data.jobId : "", requestId = typeof data.requestId === "string" ? data.requestId : "";
  if (!UUID.test(id) || !UUID.test(requestId) || typeof data.token !== "string" || !/^[a-f0-9]{64}$/.test(data.token)) return failure("invalid");
  const parsed = readPriceFields(data); if (!parsed.ok) return parsed;
  const inputDigest = createHash("sha256").update(JSON.stringify(parsed.fields)).digest("hex");
  return command(db, async tx => {
    const job = await lock(tx, viewer, id);
    const replay = await tx.auditLog.findFirst({ where: { actorId: viewer.userId, recordType: "jobs", recordId: id, action: "job.priced", after: { path: ["requestId"], equals: requestId } }, select: { after: true } });
    if (replay) {
      if (record(replay.after).confirmationDigest !== data.token || record(replay.after).inputDigest !== inputDigest) throw new Refusal(failure("changed"));
      throw new Replayed();
    }
    if (!canPublishPrice(job.status)) throw new Refusal(failure("frozen"));
    const rates = await pricingRates(tx, job), preview = previewPrice(job, parsed.fields, rates);
    if ("ok" in preview) throw new Refusal(preview);
    if (preview.token !== data.token) throw new Refusal(failure("changed"));
    const facade = { $transaction: (work: (value: Tx) => unknown) => work(tx) } as unknown as Parameters<typeof priceJob>[0];
    const priced = await priceJob(facade, { jobId: id, minutes: parsed.minutes, materialsCents: parsed.materialsCents, pricedById: viewer.userId }, { confirmedRates: rates });
    if (!priced.ok) throw new Refusal(failure("changed"));
    await applyTransition(tx, {
      audit: async (_tx, entry) => { await createAudit(tx)(viewer, "job.priced", { type: "jobs", id },
        { ...entry.before, priceCents: job.priceCents }, { ...entry.after, priceCents: priced.breakdown.customerPriceCents, requestId, confirmationDigest: preview.token, inputDigest }); },
      notify: async () => { await createNotify(tx)("job.priced", [job.customerId], { eventId: `job.price:${id}:${requestId}`, payload: { jobId: id, jobNumber: job.jobNumber } }); },
    }, { jobId: id, transition: "send-price", actor: viewer });
  });
}
/** Ordinary job conversation only: current customer/assignee + office; never merge legacy/private history. */
export async function requestPricingPhotos(db: Db, viewer: JobViewer, raw: unknown): Promise<PublishResult> {
  requirePricingOffice(viewer);
  const data = record(raw), id = typeof data.jobId === "string" ? data.jobId : "", requestId = typeof data.requestId === "string" ? data.requestId : "";
  const body = typeof data.body === "string" ? data.body.trim() : "";
  if (!UUID.test(id) || !UUID.test(requestId)) return failure("invalid");
  if (!body || body.length > 2000) return { ok: false, error: "invalid", field: "body", message: "Write a message of up to 2000 characters." };
  return command(db, async tx => {
    const job = await lock(tx, viewer, id);
    const replay = await tx.supportMessage.findUnique({ where: { requestKey: requestId }, select: { authorId: true, body: true, thread: { select: { jobId: true, userId: true, jobParticipants: true } } } });
    if (replay) {
      if (replay.authorId !== viewer.userId || replay.body !== body || replay.thread.jobId !== id || !replay.thread.jobParticipants) throw new Refusal(failure("changed"));
      throw new Replayed();
    }
    if (!canPublishPrice(job.status)) throw new Refusal(failure("frozen"));
    const existing = await tx.supportThread.findFirst({ where: { jobId: id, jobParticipants: true, status: "OPEN" }, select: { id: true } });
    const threadId = existing?.id ?? (await tx.supportThread.create({ data: { userId: job.customerId, jobId: id, jobParticipants: true, subject: "Ask for more photos" }, select: { id: true } })).id;
    if (!existing) await createAudit(tx)(viewer, "support_thread.opened", { type: "support_threads", id: threadId }, null, { jobId: id });
    const message = await tx.supportMessage.create({ data: { threadId, authorId: viewer.userId, body, requestKey: requestId }, select: { id: true } });
    await createAudit(tx)(viewer, "support_thread.message_sent", { type: "support_threads", id: threadId }, null, { messageId: message.id, photoCount: 0 });
    await createNotify(tx)("message.received", [job.customerId], { eventId: `support.message:${message.id}`, payload: { threadId, jobId: id } });
  });
}
