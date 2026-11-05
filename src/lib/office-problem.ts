import { z } from "zod";
import { parseQueueQuery, queueHref } from "./office-queues";

export type OfficeProblemReturn = { href: string; label: "Problems" };
export type OfficeProblemReportView = { id: string; topic: string; details: string; urgent: boolean; status: "OPEN" | "RESOLVED"; createdAt: string; when: string; photos: { id: string; url: string | null }[] };
export type OfficeProblemReportState = { state: "ready" | "offline"; report: OfficeProblemReportView } | { state: "loading" | "error" };
export function officeProblemId(value: unknown): string | null { const parsed = z.uuid().safeParse(value); return parsed.success ? parsed.data : null; }

/** A selected report never chooses navigation origin. Only the explicit, validated Problems origin does. */
export function officeProblemJobReturn(query: Record<string, unknown>): OfficeProblemReturn | null {
  if (query.from !== "problems") return null;
  const fallback: OfficeProblemReturn = { href: "/admin#queue-problems", label: "Problems" };
  if (typeof query.problemReturn !== "string" || query.problemReturn.length > 2048 || /[\\\r\n]/.test(query.problemReturn)) return fallback;
  try {
    const url = new URL(query.problemReturn, "https://office.invalid");
    if (url.origin !== "https://office.invalid" || url.pathname !== "/admin" || (url.hash && url.hash !== "#queue-problems")) return fallback;
    if ([...url.searchParams.keys()].some(key => !["tab", "q", "page", "problemPage"].includes(key) || url.searchParams.getAll(key).length !== 1)) return fallback;
    return { label: "Problems", href: `${queueHref(parseQueueQuery(url.searchParams))}#queue-problems` };
  } catch { return fallback; }
}
export function officeProblemJobHref(id: string, problem: unknown, back: OfficeProblemReturn | null, price = false): string {
  const query = new URLSearchParams(), reportId = officeProblemId(problem);
  if (price) query.set("dialog", "price");
  if (reportId) query.set("problem", reportId);
  if (back) { query.set("from", "problems"); query.set("problemReturn", back.href); }
  return `/admin/jobs/${encodeURIComponent(id)}${query.size ? `?${query}` : ""}${reportId ? "#problem-report" : ""}`;
}
