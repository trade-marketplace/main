import { z } from "zod";
import { SIGNUP_TRADES, type SignupTrade } from "./auth/worker-signup";

export const OFFICE_TRADIES_PAGE_SIZE = 20;
export type TradiesTab = "check" | "verified" | "paused";
export type TradiesQuery = { tab: TradiesTab; q: string; sort: "joined" | "expiry"; page: number; selected: string | null };
const values = SIGNUP_TRADES.map(trade => trade.value);
export function parseTradieSelection(value: unknown): { userId: string; trade: SignupTrade } | null {
  if (typeof value !== "string") return null;
  const [userId, trade, extra] = value.split(":");
  return !extra && z.uuid().safeParse(userId).success && values.includes(trade as SignupTrade) ? { userId, trade: trade as SignupTrade } : null;
}
export function tradiesQuery(raw: Record<string, unknown>): TradiesQuery {
  return { tab: raw.tab === "verified" || raw.tab === "paused" ? raw.tab : "check", q: typeof raw.q === "string" ? raw.q.trim().slice(0, 160) : "", sort: raw.sort === "expiry" ? "expiry" : "joined", page: typeof raw.page === "string" && /^[1-9]\d{0,5}$/.test(raw.page) ? Number(raw.page) : 1, selected: parseTradieSelection(raw.selected) ? raw.selected as string : null };
}
export function tradiesHref(query: TradiesQuery, changes: Partial<TradiesQuery> = {}): string {
  const data = { ...query, ...changes }, params = new URLSearchParams();
  if (data.tab !== "check") params.set("tab", data.tab); if (data.q) params.set("q", data.q); if (data.sort !== "joined") params.set("sort", data.sort); if (data.page > 1) params.set("page", String(data.page)); if (data.selected) params.set("selected", data.selected);
  return `/admin/tradies${params.size ? `?${params}` : ""}`;
}
const note = z.string().trim().min(1).max(2000);
const licenceBase = z.object({ userId: z.uuid(), trade: z.enum(["ELECTRICAL", "PLUMBING", "GAS", "CONSTRUCTION"]), version: z.string().regex(/^[a-f0-9]{64}$/), note });
export const tradieDecisionSchema = z.discriminatedUnion("kind", [
  licenceBase.extend({ kind: z.literal("approve") }).strict(),
  licenceBase.extend({ kind: z.literal("reject"), reason: note }).strict(),
  z.object({ kind: z.enum(["pause", "unpause"]), userId: z.uuid(), expectedPausedAt: z.iso.datetime().nullable(), note }).strict(),
]);
export type TradieDecision = z.input<typeof tradieDecisionSchema>;
export type TradieDecisionResult = { ok: true } | { ok: false; error: "invalid" | "forbidden" | "stale" | "expiry" | "unavailable" | "session-expired" };
export type TradieRow = {
  id: string; userId: string; trade: SignupTrade; name: string; joined: string; joinedAt: string; licenceNumber: string | null; expiry: string | null;
  status: "Checking" | "Checked" | "Rejected" | "Expired" | "To check" | "No licence needed"; paused: boolean;
};
export type TradieDetail = TradieRow & {
  email: string; suburb: string | null; verifiedBadge: boolean; hasWorkerProfile: boolean; pausedAt: string | null;
  licence: { id: string; version: string; documentHref: string | null; status: "PENDING" | "VERIFIED" | "REJECTED"; reason: string | null } | null;
  timeline: { id: string; action: string; actor: string; when: string; at: string; note: string | null; reason: string | null }[];
};
export type TradiesPage = { viewerId: string; rows: TradieRow[]; selected: TradieDetail | null; total: number; page: number; counts: Record<TradiesTab, number>; today: string };
export const TRADIE_ERRORS = {
  invalid: "Add a note and check the details.", forbidden: "Office access is required.", stale: "This record changed. Refresh before making a decision.", expiry: "Ask the tradie to add a current licence expiry before approving.", unavailable: "Couldn’t save. Try again.", "session-expired": "Please log in again to save.",
} as const;
