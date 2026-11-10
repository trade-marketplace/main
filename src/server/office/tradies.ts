import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { licenceState, licenceToday } from "@/lib/account/trades";
import { OFFICE_TRADIES_PAGE_SIZE, parseTradieSelection, type TradieDetail, type TradieRow, type TradiesPage, type TradiesQuery, type TradiesTab } from "@/lib/office-tradies";
import { hasCurrentTradeLicence, isVerified, WORKER_VERIFICATION_SELECT } from "@/server/workers/verification";
import { licenceReviewVersion } from "./tradie-commands";

export class OfficeTradieError extends Error { constructor(readonly code: "forbidden" | "not-found") { super(code); } }
const SELECT = { userId: true, trade: true, licence: true, user: { select: { ...WORKER_VERIFICATION_SELECT, firstName: true, lastName: true, createdAt: true, workerProfile: { select: { ...WORKER_VERIFICATION_SELECT.workerProfile.select, baseSuburb: true } } } } } satisfies Prisma.WorkerTradeSelect;
type Row = Prisma.WorkerTradeGetPayload<{ select: typeof SELECT }>;
const when = (date: Date) => new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "short", year: "numeric" }).format(date);
const fullName = (profile: { firstName: string; lastName: string | null }) => `${profile.firstName}${profile.lastName?.trim() ? ` ${profile.lastName.trim()}` : ""}`;

/** Query equivalent of the current licence proofs in workers/verification.ts; this never changes eligibility. */
function tabWhere(tab: TradiesTab, now: Date): Prisma.WorkerTradeWhereInput {
  const active: Prisma.ProfileWhereInput = { role: "TRADIE", OR: [{ workerProfile: { is: null } }, { workerProfile: { is: { pausedAt: null } } }] };
  const checked: Prisma.WorkerTradeWhereInput = { OR: [{ trade: "OTHER" }, { licence: { is: { status: "VERIFIED", checkedById: { not: null }, checkedAt: { lte: now }, expiresOn: { gte: new Date(`${licenceToday(now)}T00:00:00Z`) } } } }] };
  if (tab === "paused") return { user: { is: { role: "TRADIE", workerProfile: { is: { pausedAt: { not: null } } } } } };
  return { user: { is: active }, ...(tab === "verified" ? checked : { NOT: checked }) };
}
function summary(row: Row, now: Date): TradieRow {
  const today = licenceToday(now);
  const licence = row.licence, state = licenceState({ trade: row.trade, licence: licence ? { ...licence, expiresOn: licence.expiresOn?.toISOString().slice(0, 10) ?? null, hasDocument: Boolean(licence.documentPath) } : null }, today);
  const status = state === "none" ? "No licence needed" : state === "rejected" ? "Rejected" : state === "expired" ? "Expired" : state === "checking" ? "Checking" : hasCurrentTradeLicence(row.user, row.trade, now) ? "Checked" : "To check";
  return { id: `${row.userId}:${row.trade}`, userId: row.userId, trade: row.trade, name: fullName(row.user), joined: when(row.user.createdAt), joinedAt: row.user.createdAt.toISOString(), licenceNumber: licence?.number ?? null, expiry: licence?.expiresOn?.toISOString().slice(0, 10) ?? null, status, paused: Boolean(row.user.workerProfile?.pausedAt) };
}
const auditLabels: Record<string, string> = { "licence.submitted": "Licence submitted", "licence.verified": "Licence approved", "licence.rejected": "Licence rejected", "worker.paused": "Paused", "worker.unpaused": "Unpaused" };
export async function loadOfficeTradies(db: PrismaClient, actor: { userId: string }, query: TradiesQuery, now = new Date()): Promise<TradiesPage> {
  const current = await db.profile.findUnique({ where: { id: actor.userId }, select: { role: true } });
  if (current?.role !== "ADMIN") throw new OfficeTradieError("forbidden");
  const search: Prisma.WorkerTradeWhereInput[] = query.q.split(/\s+/).filter(Boolean).slice(0, 8).map(word => {
    const text = { contains: word, mode: "insensitive" } as const;
    return { OR: [{ user: { is: { OR: [{ firstName: text }, { lastName: text }, { email: text }] } } }, { licence: { is: { number: text } } }] };
  });
  const where = { AND: [tabWhere(query.tab, now), ...search] };
  const [total, check, verified, paused] = await Promise.all([db.workerTrade.count({ where }), ...(["check", "verified", "paused"] as const).map(tab => db.workerTrade.count({ where: tabWhere(tab, now) }))]);
  const page = Math.min(query.page, Math.max(1, Math.ceil(total / OFFICE_TRADIES_PAGE_SIZE)));
  const selection = parseTradieSelection(query.selected);
  const [rows, selected] = await Promise.all([
    db.workerTrade.findMany({ where, select: SELECT, take: OFFICE_TRADIES_PAGE_SIZE, skip: (page - 1) * OFFICE_TRADIES_PAGE_SIZE, orderBy: query.sort === "expiry" ? [{ licence: { expiresOn: { sort: "asc", nulls: "last" } } }, { userId: "asc" }, { trade: "asc" }] : [{ user: { createdAt: "desc" } }, { userId: "asc" }, { trade: "asc" }] }),
    selection ? db.workerTrade.findFirst({ where: { ...selection, user: { is: { role: "TRADIE" } } }, select: SELECT }) : null,
  ]);
  if (selection && !selected) throw new OfficeTradieError("not-found");
  let detail: TradieDetail | null = null;
  const today = licenceToday(now);
  if (selected) {
    const entries = await db.auditLog.findMany({ where: { OR: [{ recordType: "worker_profiles", recordId: selected.userId, action: { in: ["worker.paused", "worker.unpaused"] } }, ...(selected.licence ? [{ recordType: "licences", recordId: selected.licence.id, action: { in: ["licence.submitted", "licence.verified", "licence.rejected"] } }] : [])] }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 30, select: { id: true, action: true, reason: true, after: true, createdAt: true, actorId: true } });
    const actors = await db.profile.findMany({ where: { id: { in: [...new Set(entries.map(entry => entry.actorId).filter((id): id is string => Boolean(id)))] } }, select: { id: true, firstName: true, lastName: true } });
    const actorNames = new Map(actors.map(actor => [actor.id, fullName(actor)]));
    const licence = selected.licence;
    detail = { ...summary(selected, now), email: selected.user.email, suburb: selected.user.workerProfile?.baseSuburb ?? null, verifiedBadge: isVerified(selected.user, selected.trade, now), hasWorkerProfile: Boolean(selected.user.workerProfile), pausedAt: selected.user.workerProfile?.pausedAt?.toISOString() ?? null,
      licence: licence ? { id: licence.id, version: licenceReviewVersion(licence), documentHref: licence.documentPath ? `/api/admin/tradies/document?userId=${selected.userId}&trade=${selected.trade}` : null, status: licence.status, reason: licence.rejectionReason } : null,
      timeline: entries.map(entry => { const after = entry.after && typeof entry.after === "object" && !Array.isArray(entry.after) ? entry.after : {}; return { id: entry.id, action: auditLabels[entry.action] ?? entry.action, actor: entry.actorId ? actorNames.get(entry.actorId) ?? "Former member" : "System", note: entry.reason, reason: typeof after.rejectionReason === "string" ? after.rejectionReason : null, at: entry.createdAt.toISOString(), when: when(entry.createdAt) }; }),
    };
  }
  return { viewerId: actor.userId, rows: rows.map(row => summary(row, now)), selected: detail, total, page, counts: { check, verified, paused }, today };
}
