import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { licenceToday, parseTradeInput, type TradeInput, type TradeResult, type TradeSnapshot } from "@/lib/account/trades";
import { createAudit } from "@/server/audit/audit";
import { isLicenceDocument, lockLicenceDocuments } from "./licence-documents";
import { UploadError } from "@/server/files/errors";

export async function loadTrades(db: Pick<PrismaClient, "workerTrade">, userId: string, now = new Date()): Promise<TradeSnapshot> {
  const rows = await db.workerTrade.findMany({ where: { userId }, include: { licence: true }, orderBy: { createdAt: "asc" } });
  return { today: licenceToday(now), rows: rows.map(row => ({ trade: row.trade, licence: row.licence ? {
    id: row.licence.id, number: row.licence.number, status: row.licence.status,
    expiresOn: row.licence.expiresOn?.toISOString().slice(0, 10) ?? null,
    rejectionReason: row.licence.rejectionReason, hasDocument: Boolean(row.licence.documentPath),
  } : null })) };
}

/** The caller supplies the authenticated worker id; uploaded paths never come from browser text. */
export async function saveTrade(db: PrismaClient, userId: string, input: TradeInput, upload: (() => Promise<string>) | null, now = new Date()): Promise<TradeResult> {
  const parsed = parseTradeInput(input, licenceToday(now));
  if (!parsed.ok) return { ok: false, error: "invalid", fields: parsed.fields };
  const data = parsed.data;
  if (data.trade !== "OTHER" && !upload) return { ok: false, error: "invalid", fields: { document: "Add a photo or PDF of your licence." } };
  const profile = await db.profile.findUnique({ where: { id: userId }, select: { role: true } });
  if (profile?.role !== "TRADIE") return { ok: false, error: "forbidden" };
  await db.$transaction(async tx => {
    await lockLicenceDocuments(tx, userId);
    const current = await tx.profile.findUnique({ where: { id: userId }, select: { role: true } });
    if (current?.role !== "TRADIE") throw new UploadError("not-allowed", "You can't do that.");
    let documentPath: string | null = null;
    if (data.trade !== "OTHER") {
      documentPath = await upload!();
      if (!isLicenceDocument(documentPath, userId)) throw new UploadError("not-allowed", "You can't do that.");
    }
    const before = await tx.licence.findUnique({ where: { userId_trade: { userId, trade: data.trade } } });
    const existingTrade = await tx.workerTrade.findUnique({ where: { userId_trade: { userId, trade: data.trade } } });
    await tx.workerTrade.upsert({ where: { userId_trade: { userId, trade: data.trade } }, create: { userId, trade: data.trade }, update: {} });
    if (data.trade !== "OTHER") {
      const values = { number: data.number, expiresOn: new Date(`${data.expiresOn}T00:00:00Z`), documentPath, status: "PENDING" as const, checkedAt: null, checkedById: null, rejectionReason: null, expiryRemindedAt: null };
      const licence = await tx.licence.upsert({ where: { userId_trade: { userId, trade: data.trade } }, create: { userId, trade: data.trade, ...values }, update: values });
      if (before?.documentPath && before.documentPath !== documentPath && isLicenceDocument(before.documentPath, userId)) {
        await tx.licenceDocumentCleanup.upsert({ where: { path: before.documentPath }, create: { path: before.documentPath, userId }, update: {} });
      }
      await createAudit(tx)({ userId }, "licence.submitted", { type: "licences", id: licence.id }, before ? { status: before.status, trade: before.trade } : null, { status: "PENDING", trade: data.trade });
    } else if (!existingTrade) await createAudit(tx)({ userId }, "worker.trade_added", { type: "worker_profiles", id: userId }, null, { trade: "OTHER" });
  }, { timeout: 30_000 });
  return { ok: true, snapshot: await loadTrades(db, userId, now) };
}
