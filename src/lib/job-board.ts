import { z } from "zod";
import type { Trade } from "@/generated/prisma/client";
import type { JobTimeWindowView, WorkerJobListView } from "@/server/views/jobs";
import { roundKm } from "@/lib/geo/distance";
import { customerJobsReturn } from "@/lib/customer-jobs";
import type { MapboxConfig } from "@/lib/map/mapbox";

export const BOARD_PAGE_SIZE = 20;
export const BOARD_TRADES = ["ELECTRICAL", "PLUMBING", "GAS", "CONSTRUCTION", "OTHER"] as const;
export const BOARD_WHEN = ["asap", "week", "flexible"] as const;
export type BoardKind = "all" | "ready" | "estimate" | "bounty";
export type BoardSort = "nearest" | "newest" | "earn";
export type BoardWhen = typeof BOARD_WHEN[number];
export type BoardQuery = { kind: BoardKind; trades: Trade[] | null; distance: number | null; when: BoardWhen[] | null; sort: BoardSort; saved: boolean; estimated: boolean; entry: "find-work" | "all"; view: "grid" | "map" };
export const DEFAULT_BOARD_QUERY: BoardQuery = { kind: "all", trades: null, distance: null, when: null, sort: "nearest", saved: false, estimated: false, entry: "find-work", view: "grid" };
export const boardQuerySchema = z.object({ kind: z.enum(["all", "ready", "estimate", "bounty"]), trades: z.array(z.enum(BOARD_TRADES)).max(5).nullable(),
  distance: z.number().finite().positive().max(5000).nullable(), when: z.array(z.enum(BOARD_WHEN)).max(3).nullable(), sort: z.enum(["nearest", "newest", "earn"]),
  saved: z.boolean(), estimated: z.boolean(), entry: z.enum(["find-work", "all"]).default("find-work"), view: z.enum(["grid", "map"]) });

type Search = URLSearchParams | Record<string, string | string[] | undefined>;
const value = (input: Search, key: string) => input instanceof URLSearchParams ? input.get(key) ?? undefined : Array.isArray(input[key]) ? input[key]?.[0] : input[key];
function choices<T extends string>(raw: string | undefined, allowed: readonly T[], transform = (s: string) => s): T[] | null {
  if (raw === undefined) return null;
  if (raw === "none") return [];
  const requested = new Set(raw.split(",").map(transform));
  const selected = allowed.filter(item => requested.has(item));
  return selected.length === 0 || selected.length === allowed.length ? null : [...selected];
}
export function parseBoardQuery(input: Search): BoardQuery {
  const kind = value(input, "kind"), sort = value(input, "sort"), distance = Number(value(input, "distance")), view = value(input, "view"), layout = value(input, "layout");
  return { kind: kind === "ready" || kind === "estimate" || kind === "bounty" ? kind : "all",
    trades: choices(value(input, "trade"), BOARD_TRADES, s => s.toUpperCase()),
    distance: Number.isFinite(distance) && distance > 0 && distance <= 5000 ? distance : null,
    when: choices(value(input, "when"), BOARD_WHEN), sort: sort === "newest" || sort === "earn" ? sort : "nearest",
    saved: value(input, "saved") === "1", estimated: value(input, "estimated") === "1", entry: view === "all" ? "all" : "find-work",
    view: layout === "map" || layout === "grid" ? layout : view === "map" ? "map" : "grid" };
}
export function boardHref(query: BoardQuery, base = "/jobs", extra = ""): string {
  const params = new URLSearchParams(extra);
  for (const key of ["kind", "trade", "distance", "when", "sort", "saved", "estimated", "view", "layout"]) params.delete(key);
  if (query.kind !== "all") params.set("kind", query.kind);
  if (query.trades !== null) params.set("trade", query.trades.length ? BOARD_TRADES.filter(trade => query.trades!.includes(trade)).map(trade => trade.toLowerCase()).join(",") : "none");
  if (query.distance !== null) params.set("distance", String(query.distance));
  if (query.when !== null) params.set("when", query.when.length ? BOARD_WHEN.filter(when => query.when!.includes(when)).join(",") : "none");
  if (query.sort !== "nearest") params.set("sort", query.sort);
  if (query.saved) params.set("saved", "1");
  if (query.estimated) params.set("estimated", "1");
  // `view=all` is the existing phone navigation marker, not a different set of eligible jobs.
  if (query.entry === "all") { params.set("view", "all"); if (query.view === "map") params.set("layout", "map"); }
  else if (query.view !== "grid") params.set("view", query.view);
  return `${base}${params.size ? `?${params}` : ""}`;
}
/** Identify the data behind cached results independently of navigation/layout or bookmark ordering. */
export function boardSelectionKey(query: BoardQuery, savedIds: readonly string[]): string {
  return JSON.stringify([boardHref({ ...query, entry: "find-work", view: "grid" }), [...new Set(savedIds)].sort()]);
}
export function boardReturn(value: unknown, entry?: unknown): string {
  const fallback = entry === "all" ? "/jobs?view=all" : "/jobs";
  // Shared job-detail authentication also carries My jobs' return URL. Keep that bounded list query intact.
  const customerList = customerJobsReturn(value);
  if (customerList !== "/") return customerList;
  if (typeof value !== "string" || value.length > 4096 || !value.startsWith("/jobs")) return fallback;
  try {
    const url = new URL(value, "https://board.invalid");
    if (url.origin !== "https://board.invalid" || url.pathname !== "/jobs") return fallback;
    const query = parseBoardQuery(url.searchParams);
    return boardHref(entry === "all" ? { ...query, entry: "all" } : query);
  } catch { return fallback; }
}
export function boardJobHref(id: string, back: unknown): string {
  const canonical = boardReturn(back), params = new URLSearchParams();
  if (new URL(canonical, "https://board.invalid").searchParams.get("view") === "all") params.set("view", "all");
  params.set("from", canonical);
  return `/jobs/${encodeURIComponent(id)}?${params}`;
}
/** Keep the canonical board destination through a settings page's independent login guard (alerts, setup checklist #132). */
export function boardSettingsRoute(path: string, value: unknown): { href: string; back: string | null } {
  const back = typeof value === "string" && value.startsWith("/jobs") ? boardReturn(value) : null;
  return { href: back ? `${path}?next=${encodeURIComponent(back)}` : path, back };
}
export const boardAlertsRoute = (value: unknown) => boardSettingsRoute("/profile/notifications", value);

export type BoardCard = WorkerJobListView & { distanceKm: number; photoUrl: string | null; tradeLabel: string; whenLabel: string; alreadyEstimated: boolean;
  /** Map-only, from configured bounty facts and its existing status-history clock. */
  bounty?: { amountCents: number; endsAt: number; durationMs: number } };
export type BoardCounts = Record<BoardKind | "saved" | "estimated", number>;
export type BoardTrade = { trade: Trade; label: string; allowed: boolean; reason: string | null };
export type BoardMapConfig = MapboxConfig & { approxRadiusMetres: number };
export type BoardMeta = { ownerId: string; areaName: string; maxDistanceKm: number; distanceKm: number; trades: BoardTrade[]; blocked: "email-required" | "identity-required" | "worker-paused" | "work-area-required" | null;
  /** Optional map-only configuration; no job address or exact job coordinates. */
  map?: BoardMapConfig };
export type BoardPage = { meta: BoardMeta; cards: BoardCard[]; counts: BoardCounts; total: number; nextCursor: string | null; before: string; scope: string };
export type BoardResult = { ok: true; board: BoardPage } | { ok: false; error: "unavailable" | "session-expired" | "forbidden" | "changed" };
export type BoardRequest = { savedIds?: string[]; cursor?: string | null; before?: string };
export type BoardUpdates = { ok: true; count: number } | { ok: false; error: "unavailable" | "session-expired" | "forbidden" | "changed" };
export type BoardSource = { load(query: BoardQuery, request?: BoardRequest): Promise<BoardResult>; updates(query: BoardQuery, request: { since: string; knownIds: string[]; savedIds: string[] }): Promise<BoardUpdates> };

export type SortableBoardJob = Pick<BoardCard, "id" | "status" | "category" | "earnCents" | "distanceKm" | "createdAt" | "updatedAt" | "alreadyEstimated">;
export function boardCardTag(card: Pick<BoardCard, "status" | "earnCents" | "alreadyEstimated">): { kind: "earn"; text: string } | { kind: "bounty"; text: string } | { kind: "estimate" } | { kind: "estimated" } {
  if (card.status === "BOOKABLE") return { kind: "earn", text: card.earnCents === null ? "Pay pending" : `Earn ${new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", maximumFractionDigits: card.earnCents % 100 ? 2 : 0 }).format(card.earnCents / 100)}` };
  if (card.status === "QUOTE_BOUNTY") return { kind: "bounty", text: "Quote bounty" };
  return card.alreadyEstimated ? { kind: "estimated" } : { kind: "estimate" };
}
export function boardCardWhen(card: Pick<BoardCard, "asap" | "whenLabel">, when: BoardQuery["when"]): string {
  return card.asap && (when === null || when.includes("asap")) ? "ASAP" : card.whenLabel;
}
export function boardDistanceLabel(km: number): string {
  const whole = roundKm(km);
  return km < 1 ? "<1 km" : `${km < 10 ? new Intl.NumberFormat("en-NZ", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(km) : whole} km`;
}

/** A response started before a refresh/filter/bookmark change cannot repopulate its obsolete pill. */
export class BoardUpdateRequests {
  private revision = 0;
  invalidate() { this.revision++; }
  async run(request: () => Promise<BoardUpdates>): Promise<BoardUpdates | null> {
    const revision = ++this.revision, response = await request();
    return revision === this.revision ? response : null;
  }
}
export function matchesBoardKind(job: Pick<SortableBoardJob, "status">, kind: BoardKind): boolean {
  return kind === "all" || (kind === "ready" ? job.status === "BOOKABLE" : kind === "bounty" ? job.status === "QUOTE_BOUNTY" : job.status === "REVIEW");
}
export function boardSortValue(job: SortableBoardJob, sort: BoardSort): number {
  return sort === "nearest" ? job.distanceKm : sort === "newest" ? Date.parse(job.createdAt) : job.earnCents ?? -1;
}
export function compareBoardJobs(a: SortableBoardJob, b: SortableBoardJob, sort: BoardSort): number {
  const difference = boardSortValue(a, sort) - boardSortValue(b, sort);
  return (sort === "nearest" ? difference : -difference) || a.id.localeCompare(b.id);
}

const cursorSchema = z.object({ version: z.literal(1), scope: z.string().min(1).max(128), before: z.iso.datetime(), anchor: z.object({ id: z.uuid(), value: z.number().finite() }) });
export type BoardCursor = z.infer<typeof cursorSchema>;
export function encodeBoardCursor(cursor: BoardCursor): string { return btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }
export function decodeBoardCursor(raw: string | null | undefined): BoardCursor | null {
  if (!raw || raw.length > 2048) return null;
  try { const parsed = cursorSchema.safeParse(JSON.parse(atob(raw.replaceAll("-", "+").replaceAll("_", "/")))); return parsed.success ? parsed.data : null; }
  catch { return null; }
}
export function afterBoardCursor(job: SortableBoardJob, cursor: BoardCursor, sort: BoardSort): boolean {
  const difference = boardSortValue(job, sort) - cursor.anchor.value;
  return (sort === "nearest" ? difference : -difference) > 0 || (difference === 0 && job.id.localeCompare(cursor.anchor.id) > 0);
}

/** Dates are New Zealand calendar days; DB date fields are represented at UTC midnight. */
export function boardToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function boardWeek(now: Date): { start: Date; end: Date } {
  const start = new Date(`${boardToday(now)}T00:00:00Z`); start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
  return { start, end };
}
/** A part of today's date stays valid all day; no booking-hour expiry policy is inferred here. */
export function boardAvailabilityWindow(windows: readonly JobTimeWindowView[], when: BoardQuery["when"], now: Date): JobTimeWindowView | null {
  const order = { MORNING: 0, AFTERNOON: 1, EVENING: 2 };
  const today = boardToday(now);
  const upcoming = windows.filter(window => window.date >= today).sort((a, b) => a.date.localeCompare(b.date) || order[a.timeOfDay] - order[b.timeOfDay]);
  const end = boardWeek(now).end.toISOString().slice(0, 10);
  return (when?.includes("week") ? upcoming.find(window => window.date <= end) : null) ?? upcoming[0] ?? null;
}
export const savedJobsKey = (ownerId: string) => `trade.jobs.saved.v1.${ownerId}`;
export function parseSavedJobs(raw: string | null): string[] {
  if (!raw) return [];
  const result = z.array(z.uuid()).max(5000).safeParse(JSON.parse(raw));
  if (!result.success) throw new Error("saved-jobs-unavailable");
  return [...new Set(result.data)];
}
