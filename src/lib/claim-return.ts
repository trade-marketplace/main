import { z } from "zod";
import { boardJobHref, boardReturn } from "./job-board";

/** A claim can return only to this exact job and a canonical, bounded worker board query. */
export function claimJobReturn(value: unknown, expectedJobId?: string): string | null {
  if (typeof value !== "string" || value.length > 4096 || !value.startsWith("/jobs/")) return null;
  try {
    const url = new URL(value, "https://claim.invalid"), id = url.pathname.slice(6);
    if (url.origin !== "https://claim.invalid" || url.hash || !z.uuid().safeParse(id).success || (expectedJobId && id !== expectedJobId)) return null;
    for (const key of url.searchParams.keys()) if (!["from", "view"].includes(key) || url.searchParams.getAll(key).length !== 1) return null;
    const back = url.searchParams.get("from");
    if (!back || !back.startsWith("/jobs") || boardReturn(back) !== back) return null;
    const board = new URL(back, "https://claim.invalid");
    if (board.pathname !== "/jobs" || board.hash) return null;
    for (const key of board.searchParams.keys()) if (board.searchParams.getAll(key).length !== 1) return null;
    return boardJobHref(id, back) === value ? value : null;
  } catch { return null; }
}

export function claimReturnFromQuery(query: Record<string, string | string[] | undefined>, kind: "list" | "thread", expectedJobId?: string) {
  const allowed = kind === "list" ? ["job", "returnTo"] : ["before", "returnTo"];
  if (Object.entries(query).some(([key, value]) => !allowed.includes(key) || Array.isArray(value))) return null;
  if (kind === "list" && typeof query.job !== "string") return null;
  if (kind === "list" && expectedJobId && query.job !== expectedJobId) return null;
  return claimJobReturn(query.returnTo, expectedJobId ?? (kind === "list" ? query.job as string : undefined));
}

/** Used locally by the client; server pages recheck the return against the authorized job after loading. */
export function claimMessageHref(href: string, returnTo?: string | null) {
  const safe = claimJobReturn(returnTo); if (!safe) return href;
  const url = new URL(href, "https://claim.invalid");
  if (url.origin !== "https://claim.invalid" || !/^\/messages(?:\/[0-9a-f-]{36})?$/.test(url.pathname)) return href;
  if (url.searchParams.has("job") && url.searchParams.get("job") !== new URL(safe, "https://claim.invalid").pathname.slice(6)) return href;
  url.searchParams.set("returnTo", safe);
  return `${url.pathname}?${url.searchParams}`;
}
