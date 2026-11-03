import type { QueueData, QueueKey, QueueQuery, QueueRow } from "@/lib/office-queues";

export const QUEUE_PREVIEW_STATES = ["price", "extra", "cancel", "signoff", "unclaimed", "all-clear", "loading", "error", "offline", "search", "search-empty", "long"] as const;
export type QueuePreviewState = typeof QUEUE_PREVIEW_STATES[number];
const ago = (hours: number) => new Date(Date.parse("2026-11-03T00:00:00Z") - hours * 3_600_000).toISOString();
const id = (value: number) => `de000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
const row = (value: number, title: string, hours: number, changes: Partial<QueueRow> = {}): QueueRow => ({
  id: id(value), jobId: id(value), number: `TM-${1000 + value - 0xb000}`, title, trade: "Electrical", status: "REVIEW",
  customer: "Sarah T", tradie: null, suburb: "Windsor", estimates: "5", spread: "3.0–4.5 h · $60–110", context: "—",
  waiting: `${hours}h`, since: ago(hours), overdue: hours >= 24, action: "Price it", href: `/admin/jobs/${id(value)}?dialog=price`, ...changes,
});
const PRICING = [
  row(0xb001, "Switchboard upgrade", 26, { customer: "Tom H", suburb: "Richmond", estimates: "1 · site visit asked", spread: "—" }),
  row(0xb003, "Kitchen tap leaking", 5, { trade: "Plumbing", estimates: "2", spread: "1.0–1.5 h · $30–45" }),
  row(0xb002, "Sub wiring", 2),
  row(0xb004, "Hot water cylinder", 1, { customer: "Ana P", suburb: "Waikiwi", trade: "Plumbing", estimates: "0", spread: "—", action: "Open", href: `/admin/jobs/${id(0xb004)}` }),
];
const other = (tab: QueueKey): QueueRow[] => {
  const count = tab === "extra" ? 2 : tab === "signoff" ? 3 : 1;
  return Array.from({ length: count }, (_, index) => row(0xb006 + index, ["Outdoor double plug", "Kitchen reno", "Heat pump"][index], tab === "unclaimed" ? 55 : 3 - index, {
    status: tab === "cancel" ? "CANCEL_REVIEW" : tab === "signoff" ? "SUBMITTED" : tab === "unclaimed" ? "BOOKABLE" : "ASSIGNED", tradie: tab === "unclaimed" ? null : "Jack W",
    context: tab === "extra" ? "New breaker and cable." : tab === "cancel" ? "Customer asked to cancel." : "3 Nov, 3:00 pm",
    action: "Open", href: `/admin/jobs/${id(0xb006 + index)}`, overdue: tab === "unclaimed",
  }));
};

export function previewQueues(state: QueuePreviewState, query: QueueQuery): QueueData {
  const counts = { price: 4, extra: 2, cancel: 1, signoff: 3, unclaimed: 1 };
  const empty = state === "all-clear";
  const kpis = Object.fromEntries(Object.entries(counts).map(([key, count]) => [key, { count: empty ? 0 : count,
    oldestAt: empty ? null : ago(key === "price" ? 26 : key === "unclaimed" ? 55 : 3), overdue: !empty && ["price", "unclaimed"].includes(key),
    detail: key === "signoff" ? `${empty ? 0 : 2} auto-release today` : empty ? "—" : key === "cancel" ? "new" : key === "unclaimed" ? "Richmond" : key === "price" ? "oldest 26h" : "oldest 3h" }])) as QueueData["kpis"];
  let rows = empty || state === "search-empty" ? [] : query.tab === "price" ? PRICING : other(query.tab);
  if (state === "search") rows = [row(0xb006, "Outdoor double plug", 3, { status: "ASSIGNED", tradie: "Jack W", action: "Open", href: `/admin/jobs/${id(0xb006)}` })];
  if (state === "long") rows = rows.map(item => ({ ...item, title: "Replace all the guttering, downpipes and rotten fascia boards on a two-storey villa, and take the old ones away", customer: "Wiremu Hēnare-Fitzgerald-MacPherson", suburb: "Invercargill Central Business District" }));
  if (query.q) rows = rows.map(item => ({ ...item, action: "Open" as const, href: `/admin/jobs/${item.jobId}` }));
  return { kpis, rows, total: rows.length, page: 1, date: "Tue 3 Nov", things: empty ? 0 : 12, counts: { queues: empty ? 0 : 11, tradies: empty ? 0 : 3, support: empty ? 0 : 2 }, waitingCustomer: empty ? 0 : 2,
    problems: empty ? [] : [{ id: "case-1", jobId: id(0xb008), number: "TM-1008", title: "Kitchen reno", topic: "Work not finished", reported: "4h", since: ago(4), href: `/admin/jobs/${id(0xb008)}` }], problemCount: empty ? 0 : 1, problemPage: 1 };
}
