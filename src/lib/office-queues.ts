import type { JobStatus } from "@/generated/prisma/enums";
import type { OfficeCounts } from "@/components/office/office-links";

export const QUEUES = [
  { key: "price", label: "To price" },
  { key: "extra", label: "Extra work" },
  { key: "cancel", label: "Cancellations" },
  { key: "signoff", label: "Sign-off" },
  { key: "unclaimed", label: "Unclaimed", cardLabel: "Unclaimed > 48h" },
] as const;
export type QueueKey = typeof QUEUES[number]["key"];
export const QUEUE_PAGE_SIZE = 25;
export type QueueQuery = { tab: QueueKey; q: string; page: number; problemPage: number };
export type QueueKpi = { count: number; oldestAt: string | null; overdue: boolean; detail: string };
export type QueueRow = {
  id: string; jobId: string; number: string; title: string; trade: string; status: JobStatus;
  customer: string; tradie: string | null; suburb: string;
  estimates: string; spread: string; context: string; waiting: string; since: string;
  overdue: boolean; action: "Price it" | "Open"; href: string;
};
export type QueueProblem = { id: string; jobId: string; number: string; title: string; topic: string; reported: string; since: string; href: string };
export type QueueData = {
  kpis: Record<QueueKey, QueueKpi>; rows: QueueRow[]; total: number; page: number;
  things: number; date: string; counts: OfficeCounts; waitingCustomer: number;
  problems: QueueProblem[]; problemCount: number; problemPage: number;
};

type Params = URLSearchParams | Record<string, string | string[] | undefined>;
export function parseQueueQuery(params: Params): QueueQuery {
  const read = (key: string) => { const value = params instanceof URLSearchParams ? params.get(key) : params[key]; return (Array.isArray(value) ? value[0] : value)?.trim() ?? ""; };
  const tab = read("tab");
  const page = (key: string) => { const value = Number(read(key)); return Number.isSafeInteger(value) && value > 1 ? Math.min(value, 1_000_000) : 1; };
  return { tab: QUEUES.some(item => item.key === tab) ? tab as QueueKey : "price", q: read("q").slice(0, 80), page: page("page"), problemPage: page("problemPage") };
}
export function queueHref(query: QueueQuery, change: Partial<QueueQuery> = {}, base = "/admin") {
  const next = { ...query, ...change }, params = new URLSearchParams();
  if (next.tab !== "price") params.set("tab", next.tab);
  if (next.q) params.set("q", next.q);
  if (next.page > 1) params.set("page", String(next.page));
  if (next.problemPage > 1) params.set("problemPage", String(next.problemPage));
  return `${base}${params.size ? `?${params}` : ""}`;
}
export function waitingLabel(since: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60_000));
  if (minutes < 1) return "new";
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}

/** The slash shortcut never takes focus from a form, menu or modal. */
export function canFocusQueueSearch(event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "defaultPrevented">, target: Element | null, modalOpen: boolean) {
  return event.key === "/" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.defaultPrevented && !modalOpen
    && !target?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='dialog'], [role='menu']");
}
