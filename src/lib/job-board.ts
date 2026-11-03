import { z } from "zod";
import type { Trade } from "@/generated/prisma/client";
import type { WorkerJobListView } from "@/server/views/jobs";

export const BOARD_PAGE_SIZE = 12;
export const BOARD_TRADES = ["ELECTRICAL", "PLUMBING", "GAS", "CONSTRUCTION", "OTHER"] as const;
export const BOARD_WHEN = ["asap", "week", "flexible"] as const;
export type BoardKind = "all" | "ready" | "estimate" | "bounty";
export type BoardSort = "nearest" | "newest" | "earn";
export type BoardWhen = typeof BOARD_WHEN[number];
export type BoardQuery = { kind: BoardKind; trades: Trade[] | null; distance: number | null; when: BoardWhen[] | null; sort: BoardSort; saved: boolean; estimated: boolean; view: "grid" | "map" };
export const DEFAULT_BOARD_QUERY: BoardQuery = { kind: "all", trades: null, distance: null, when: null, sort: "nearest", saved: false, estimated: false, view: "grid" };
export const boardQuerySchema = z.object({ kind: z.enum(["all", "ready", "estimate", "bounty"]), trades: z.array(z.enum(BOARD_TRADES)).max(5).nullable(),
  distance: z.number().finite().positive().max(5000).nullable(), when: z.array(z.enum(BOARD_WHEN)).max(3).nullable(), sort: z.enum(["nearest", "newest", "earn"]),
  saved: z.boolean(), estimated: z.boolean(), view: z.enum(["grid", "map"]) });

type Search = URLSearchParams | Record<string, string | string[] | undefined>;
const value = (input: Search, key: string) => input instanceof URLSearchParams ? input.get(key) ?? undefined : Array.isArray(input[key]) ? input[key]?.[0] : input[key];
function choices<T extends string>(raw: string | undefined, allowed: readonly T[], transform = (s: string) => s): T[] | null {
  if (raw === undefined) return null;
  if (raw === "none") return [];
  const requested = new Set(raw.split(",").map(transform));
  const selected = allowed.filter(item => requested.has(item));
  return selected.length === allowed.length ? null : [...selected];
}
export function parseBoardQuery(input: Search): BoardQuery {
  const kind = value(input, "kind"), sort = value(input, "sort"), distance = Number(value(input, "distance"));
  return { kind: kind === "ready" || kind === "estimate" || kind === "bounty" ? kind : "all",
    trades: choices(value(input, "trade"), BOARD_TRADES, s => s.toUpperCase()),
    distance: Number.isFinite(distance) && distance > 0 && distance <= 5000 ? distance : null,
    when: choices(value(input, "when"), BOARD_WHEN), sort: sort === "newest" || sort === "earn" ? sort : "nearest",
    saved: value(input, "saved") === "1", estimated: value(input, "estimated") === "1", view: value(input, "view") === "map" ? "map" : "grid" };
}
export function boardHref(query: BoardQuery, base = "/jobs", extra = ""): string {
  const params = new URLSearchParams(extra);
  for (const key of ["kind", "trade", "distance", "when", "sort", "saved", "estimated", "view"]) params.delete(key);
  if (query.kind !== "all") params.set("kind", query.kind);
  if (query.trades !== null) params.set("trade", query.trades.length ? BOARD_TRADES.filter(trade => query.trades!.includes(trade)).map(trade => trade.toLowerCase()).join(",") : "none");
  if (query.distance !== null) params.set("distance", String(query.distance));
  if (query.when !== null) params.set("when", query.when.length ? BOARD_WHEN.filter(when => query.when!.includes(when)).join(",") : "none");
  if (query.sort !== "nearest") params.set("sort", query.sort);
  if (query.saved) params.set("saved", "1");
  if (query.estimated) params.set("estimated", "1");
  if (query.view !== "grid") params.set("view", query.view);
  return `${base}${params.size ? `?${params}` : ""}`;
}
export function boardReturn(value: string | null | undefined): string {
  if (!value || value.length > 4096 || !value.startsWith("/jobs")) return "/jobs";
  try { const url = new URL(value, "https://board.invalid"); return url.origin === "https://board.invalid" && url.pathname === "/jobs" ? boardHref(parseBoardQuery(url.searchParams)) : "/jobs"; }
  catch { return "/jobs"; }
}

export type BoardCard = WorkerJobListView & { distanceKm: number; photoUrl: string | null; tradeLabel: string; whenLabel: string; alreadyEstimated: boolean };
export type BoardCounts = Record<BoardKind | "saved" | "estimated", number>;
export type BoardTrade = { trade: Trade; label: string; allowed: boolean; reason: string | null };
export type BoardMeta = { ownerId: string; areaName: string; maxDistanceKm: number; distanceKm: number; trades: BoardTrade[]; blocked: "email-required" | "identity-required" | "worker-paused" | "work-area-required" | null };
export type BoardPage = { meta: BoardMeta; cards: BoardCard[]; counts: BoardCounts; total: number; nextCursor: string | null; before: string; scope: string };
export type BoardResult = { ok: true; board: BoardPage } | { ok: false; error: "unavailable" | "session-expired" | "forbidden" | "changed" };
export type BoardRequest = { savedIds?: string[]; cursor?: string | null; before?: string };
export type BoardUpdates = { ok: true; count: number } | { ok: false; error: "unavailable" | "session-expired" | "forbidden" | "changed" };
export type BoardSource = { load(query: BoardQuery, request?: BoardRequest): Promise<BoardResult>; updates(query: BoardQuery, request: { since: string; knownIds: string[]; savedIds: string[] }): Promise<BoardUpdates> };

export type SortableBoardJob = Pick<BoardCard, "id" | "status" | "category" | "earnCents" | "distanceKm" | "createdAt" | "updatedAt" | "alreadyEstimated">;
export function boardCardTag(card: Pick<BoardCard, "status" | "earnCents" | "alreadyEstimated">): { kind: "earn"; text: string } | { kind: "bounty"; text: string } | { kind: "estimate" } | { kind: "estimated" } {
  if (card.status === "BOOKABLE") return { kind: "earn", text: card.earnCents === null ? "Pay pending" : `Earn ${new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", maximumFractionDigits: card.earnCents % 100 ? 2 : 0 }).format(card.earnCents / 100)}` };
  return card.alreadyEstimated ? { kind: "estimated" } : card.status === "QUOTE_BOUNTY" ? { kind: "bounty", text: "Quote bounty" } : { kind: "estimate" };
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
  return kind === "all" || (kind === "ready" ? job.status === "BOOKABLE" : kind === "bounty" ? job.status === "QUOTE_BOUNTY" : job.status === "REVIEW" || job.status === "QUOTE_BOUNTY");
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
export function boardWeek(now: Date): { start: Date; end: Date } {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const start = new Date(`${day}T00:00:00Z`); start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
  return { start, end };
}
export const savedJobsKey = (ownerId: string) => `trade.jobs.saved.v1.${ownerId}`;
export function parseSavedJobs(raw: string | null): string[] {
  if (!raw) return [];
  const result = z.array(z.uuid()).max(5000).safeParse(JSON.parse(raw));
  if (!result.success) throw new Error("saved-jobs-unavailable");
  return [...new Set(result.data)];
}
