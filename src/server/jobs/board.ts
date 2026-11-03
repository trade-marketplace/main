import "server-only";

import { createHash } from "node:crypto";
import { unstable_noStore as noStore } from "next/cache";
import type { Prisma, PrismaClient, Trade } from "@/generated/prisma/client";
import { licenceToday, tradeLabel } from "@/lib/account/trades";
import { haversineKm } from "@/lib/geo/distance";
import { afterBoardCursor, BOARD_PAGE_SIZE, BOARD_TRADES, boardAvailabilityWindow, boardHref, boardSortValue, boardToday, boardWeek, compareBoardJobs, decodeBoardCursor, encodeBoardCursor, matchesBoardKind,
  type BoardCard, type BoardCounts, type BoardMeta, type BoardQuery, type BoardRequest, type BoardResult, type BoardUpdates, type SortableBoardJob } from "@/lib/job-board";
import { canViewJobFiles } from "@/server/files/access";
import { createSupabaseFileStore, PHOTO_BUCKET, SIGNED_URL_SECONDS } from "@/server/files/storage";
import { JOB_DETAIL_SELECT, JOB_LIST_SELECT, workerJobListView, workerJobView, type JobViewer, type WorkerJobView } from "@/server/views";
import { eligibleJobsFor, workerWorkArea, WORKER_ELIGIBILITY_SELECT, type EligibilityWorker } from "@/server/workers/eligibility";
import { hasCurrentTradeLicence, workerBasicProofFailure } from "@/server/workers/verification";

const SCAN_PAGE_SIZE = 100;
type Candidate = SortableBoardJob & { view: NonNullable<ReturnType<typeof workerJobListView>> };
export type BoardDependencies = { now?: () => Date; signPhoto?: (viewer: JobViewer, jobId: string, photoId: string) => Promise<string | null> };
const zeroCounts = (): BoardCounts => ({ all: 0, ready: 0, estimate: 0, bounty: 0, saved: 0, estimated: 0 });

function metaFor(worker: EligibilityWorker, query: BoardQuery, enabled: readonly Trade[], now: Date): BoardMeta {
  const basic = workerBasicProofFailure(worker, now);
  const area = worker.workerProfile;
  const workArea = workerWorkArea(worker), maxDistanceKm = workArea?.radiusKm ?? 0;
  return { ownerId: worker.id, areaName: area?.baseSuburb?.trim() || "your area", maxDistanceKm,
    distanceKm: Math.min(query.distance ?? Math.min(25, maxDistanceKm), maxDistanceKm),
    blocked: basic === "worker-required" ? "identity-required" : basic ?? (!workArea ? "work-area-required" : null),
    trades: BOARD_TRADES.map(trade => ({ trade, label: tradeLabel(trade), allowed: enabled.includes(trade) && (trade === "OTHER" || hasCurrentTradeLicence(worker, trade, now)),
      reason: !enabled.includes(trade) ? "Unavailable" : trade !== "OTHER" && !hasCurrentTradeLicence(worker, trade, now) ? "not verified" : null })) };
}

function whereWhen(query: BoardQuery, now: Date): Prisma.JobWhereInput {
  if (query.when === null) return {};
  const week = boardWeek(now);
  return { OR: query.when.map(when => when === "asap" ? { asap: true } : when === "flexible" ? { anyTime: true }
    : { timeWindows: { some: { date: { gte: new Date(`${boardToday(now)}T00:00:00Z`), lte: week.end } } } }) };
}
function scopeFor(worker: EligibilityWorker, query: BoardQuery, enabled: readonly Trade[], savedIds: string[], now: Date): string {
  const proofs = { ...worker, workerTrades: [...worker.workerTrades].sort((a, b) => a.trade.localeCompare(b.trade)) };
  return createHash("sha256").update(JSON.stringify([proofs, boardHref({ ...query, entry: "find-work", view: "grid" }), BOARD_TRADES.filter(trade => enabled.includes(trade)), query.saved ? [...new Set(savedIds)].sort() : [], licenceToday(now)])).digest("hex");
}

/** Scan narrow server-only candidates in bounded batches. No early cap may turn an ineligible first page into empty. */
async function candidatesFor(db: PrismaClient, viewer: JobViewer, worker: EligibilityWorker, query: BoardQuery, meta: BoardMeta, enabled: Trade[], before: Date, now: Date, since?: Date): Promise<Candidate[]> {
  const area = worker.workerProfile!;
  const centre = { lat: area.areaLat!, lng: area.areaLng! };
  const allowed = meta.trades.filter(trade => trade.allowed && (query.trades === null || query.trades.includes(trade.trade))).map(trade => trade.trade);
  if (!allowed.length || query.when?.length === 0) return [];
  // This prefilter uses the same approximate coordinates as the final radius decision, never the house.
  const latitudeSpan = meta.distanceKm / 110;
  const longitudeSpan = meta.distanceKm / (110 * Math.cos(centre.lat * Math.PI / 180));
  let after: string | undefined;
  const candidates: Candidate[] = [];
  for (;;) {
    const rows = await db.job.findMany({ where: { status: { in: ["REVIEW", "QUOTE_BOUNTY", "BOOKABLE"] }, workerId: null, customerId: { not: viewer.userId }, category: { in: allowed },
      updatedAt: { lte: before, ...(since ? { gt: since } : {}) }, approxLat: { gte: centre.lat - latitudeSpan, lte: centre.lat + latitudeSpan }, approxLng: { gte: centre.lng - longitudeSpan, lte: centre.lng + longitudeSpan },
      ...(after ? { id: { gt: after } } : {}), ...whereWhen(query, now) }, select: JOB_LIST_SELECT, orderBy: { id: "asc" }, take: SCAN_PAGE_SIZE });
    if (!rows.length) break;
    const ids = new Set(eligibleJobsFor(worker, rows, { now, enabledTrades: enabled }));
    const own = ids.size ? await db.estimate.findMany({ where: { workerId: viewer.userId, jobId: { in: [...ids] } }, select: { jobId: true } }) : [];
    const estimated = new Set(own.map(row => row.jobId));
    for (const row of rows) {
      if (!ids.has(row.id)) continue;
      const view = workerJobListView(viewer, row);
      if (!view || view.precision !== "approximate" || !view.point) continue;
      const distanceKm = haversineKm(centre, view.point);
      if (distanceKm > meta.distanceKm) continue;
      candidates.push({ ...view, distanceKm, alreadyEstimated: estimated.has(row.id), view });
    }
    after = rows[rows.length - 1].id;
    if (rows.length < SCAN_PAGE_SIZE) break;
  }
  return candidates;
}

function countsAndRows(candidates: Candidate[], query: BoardQuery, savedIds: string[]): { counts: BoardCounts; rows: Candidate[] } {
  const saved = new Set(savedIds), counts = zeroCounts();
  counts.saved = candidates.filter(job => saved.has(job.id) && (!query.estimated || job.alreadyEstimated)).length;
  counts.estimated = candidates.filter(job => job.alreadyEstimated && (!query.saved || saved.has(job.id))).length;
  const selected = candidates.filter(job => (!query.saved || saved.has(job.id)) && (!query.estimated || job.alreadyEstimated));
  for (const job of selected) {
    counts.all++;
    if (job.status === "BOOKABLE") counts.ready++;
    else counts.estimate++;
    if (job.status === "QUOTE_BOUNTY") counts.bounty++;
  }
  return { counts, rows: selected.filter(job => matchesBoardKind(job, query.kind)).sort((a, b) => compareBoardJobs(a, b, query.sort)) };
}

function whenLabel(view: WorkerJobView, query: BoardQuery, now: Date): string {
  const window = boardAvailabilityWindow(view.timeWindows, query.when, now);
  const matchesWeek = query.when?.includes("week") && window && window.date <= boardWeek(now).end.toISOString().slice(0, 10);
  if (view.anyTime && !matchesWeek) return "Flexible";
  if (!window) return "Time to be arranged";
  const day = new Intl.DateTimeFormat("en-NZ", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${window.date}T00:00:00Z`));
  return `${day} · ${window.timeOfDay === "MORNING" ? "Morning" : window.timeOfDay === "AFTERNOON" ? "Afternoon" : "Evening"}`;
}

/** Sign one final-card photo only, after a fresh shared file-access check. Never sign discarded candidates. */
async function signBoardPhoto(db: PrismaClient, viewer: JobViewer, jobId: string, photoId: string): Promise<string | null> {
  const access = await db.job.findUnique({ where: { id: jobId }, select: { customerId: true, workerId: true, status: true } });
  if (!access || !canViewJobFiles(viewer, access)) return null;
  const photo = await db.jobPhoto.findFirst({ where: { id: photoId, jobId }, select: { path: true } });
  return photo ? createSupabaseFileStore().signedUrl(PHOTO_BUCKET, photo.path, SIGNED_URL_SECONDS) : null;
}

export async function loadJobBoard(db: PrismaClient, viewer: JobViewer, query: BoardQuery, request: BoardRequest = {}, deps: BoardDependencies = {}): Promise<BoardResult> {
  noStore();
  if (viewer.role !== "TRADIE") return { ok: false, error: "forbidden" };
  try {
    const now = (deps.now ?? (() => new Date()))();
    const worker = await db.profile.findUnique({ where: { id: viewer.userId }, select: WORKER_ELIGIBILITY_SELECT });
    if (!worker || worker.role !== "TRADIE") return { ok: false, error: "forbidden" };
    const settings = await db.settings.findUnique({ where: { id: 1 }, select: { enabledTrades: true } });
    const enabled = settings?.enabledTrades ?? [...BOARD_TRADES];
    const meta = metaFor(worker, query, enabled, now), savedIds = request.savedIds ?? [];
    const scope = scopeFor(worker, query, enabled, savedIds, now);
    const cursor = decodeBoardCursor(request.cursor);
    if (request.cursor && (!cursor || cursor.scope !== scope)) return { ok: false, error: "changed" };
    const before = new Date(cursor?.before ?? request.before ?? now.toISOString());
    if (!Number.isFinite(before.getTime()) || before.getTime() > now.getTime() + 60_000) return { ok: false, error: "changed" };
    if (meta.blocked) return { ok: true, board: { meta, cards: [], counts: zeroCounts(), total: 0, nextCursor: null, before: before.toISOString(), scope } };
    const candidates = await candidatesFor(db, viewer, worker, query, meta, enabled, before, now);
    const { counts, rows } = countsAndRows(candidates, query, savedIds);
    const remaining = cursor ? rows.filter(row => afterBoardCursor(row, cursor, query.sort)) : rows;
    const cards: BoardCard[] = [];
    let scanned: Candidate | undefined;
    let index = 0;
    for (; index < remaining.length && cards.length < BOARD_PAGE_SIZE; index++) {
      const candidate = remaining[index]; scanned = candidate;
      const raw = await db.job.findUnique({ where: { id: candidate.id }, select: JOB_DETAIL_SELECT });
      if (!raw || !eligibleJobsFor(worker, [raw], { now, enabledTrades: enabled }).length) continue;
      const safe = workerJobListView(viewer, raw), detail = workerJobView(viewer, raw);
      if (!safe || !detail || safe.precision !== "approximate" || !safe.point) continue;
      const distanceKm = haversineKm({ lat: worker.workerProfile!.areaLat!, lng: worker.workerProfile!.areaLng! }, safe.point);
      if (distanceKm > meta.distanceKm) continue;
      let photoUrl: string | null = null;
      if (detail.photos[0]) {
        try { photoUrl = await (deps.signPhoto ?? ((actor, id, photo) => signBoardPhoto(db, actor, id, photo)))(viewer, raw.id, detail.photos[0].id); }
        catch { /* A missing/unavailable photo keeps the honest no-photo kit fallback. */ }
      }
      cards.push({ ...safe, distanceKm, photoUrl, tradeLabel: tradeLabel(safe.category), whenLabel: whenLabel(detail, query, now), alreadyEstimated: Boolean(detail.ownEstimate) });
    }
    const nextCursor = index < remaining.length && scanned ? encodeBoardCursor({ version: 1, scope, before: before.toISOString(), anchor: { id: scanned.id, value: boardSortValue(scanned, query.sort) } }) : null;
    return { ok: true, board: { meta, cards, counts, total: rows.length, nextCursor, before: before.toISOString(), scope } };
  } catch { console.error("Job board unavailable."); return { ok: false, error: "unavailable" }; }
}

export async function newBoardJobs(db: PrismaClient, viewer: JobViewer, query: BoardQuery, request: { since: string; knownIds: string[]; savedIds: string[] }, deps: BoardDependencies = {}): Promise<BoardUpdates> {
  noStore();
  if (viewer.role !== "TRADIE") return { ok: false, error: "forbidden" };
  try {
    const now = (deps.now ?? (() => new Date()))(), since = Date.parse(request.since);
    if (!Number.isFinite(since) || since > now.getTime() + 60_000) return { ok: false, error: "changed" };
    const worker = await db.profile.findUnique({ where: { id: viewer.userId }, select: WORKER_ELIGIBILITY_SELECT });
    if (!worker || worker.role !== "TRADIE") return { ok: false, error: "forbidden" };
    const settings = await db.settings.findUnique({ where: { id: 1 }, select: { enabledTrades: true } });
    const enabled = settings?.enabledTrades ?? [...BOARD_TRADES], meta = metaFor(worker, query, enabled, now);
    if (meta.blocked) return { ok: true, count: 0 };
    // Scan only recently changed matching candidates; no detail rows or file URLs are fetched.
    const candidates = await candidatesFor(db, viewer, worker, query, meta, enabled, now, now, new Date(since));
    const { rows } = countsAndRows(candidates, query, request.savedIds), known = new Set(request.knownIds);
    return { ok: true, count: rows.filter(row => !known.has(row.id)).length };
  } catch { console.error("Job board updates unavailable."); return { ok: false, error: "unavailable" }; }
}
