/** Browser-safe inbox view. Raw payloads and recipient ids never leave the server. */
export type InboxItem = {
  id: string;
  line: string;
  icon: string;
  href: string;
  createdAt: string;
  readAt: string | null;
};

export type InboxSnapshot = { items: InboxItem[]; unread: number };
export type InboxResult = { ok: true; inbox: InboxSnapshot } | { ok: false; error: "unavailable" | "forbidden" | "session-expired" };
export type InboxSource = { load: () => Promise<InboxResult>; read: (id: string | null) => Promise<InboxResult> };

export const NOTIFICATIONS_PAGE_SIZE = 25;
export type NotificationsQuery = { filter: "all" | "unread"; page: number };
export type NotificationsPage = InboxSnapshot & { total: number; page: number };
export type NotificationsResult = { ok: true; inbox: NotificationsPage } | Extract<InboxResult, { ok: false }>;
export type NotificationsSource = {
  load: (query: NotificationsQuery) => Promise<NotificationsResult>;
  read: (id: string | null, query: NotificationsQuery) => Promise<NotificationsResult>;
};

/** Normalize untrusted URL/action input before it reaches a database query. */
export function notificationsQuery(input: unknown): NotificationsQuery {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const page = typeof value.page === "number" || typeof value.page === "string" ? Number(value.page) : 1;
  return { filter: value.filter === "unread" ? "unread" : "all", page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 1_000_000) : 1 };
}

export function notificationsHref(query: NotificationsQuery, base = "/notifications", extra = ""): string {
  const params = new URLSearchParams(extra);
  params.delete("filter"); params.delete("page");
  if (query.filter === "unread") params.set("filter", "unread");
  if (query.page > 1) params.set("page", String(query.page));
  return `${base}${params.size ? `?${params}` : ""}`;
}

const calendar = new Intl.DateTimeFormat("en-NZ", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Pacific/Auckland" });
const dayLabel = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "long", year: "numeric", timeZone: "Pacific/Auckland" });

/** Group by the recipient's New Zealand calendar day, including across DST/midnight. */
export function notificationDays(items: readonly InboxItem[], now: number) {
  const groups: { key: string; label: string; items: InboxItem[] }[] = [];
  for (const item of items) {
    const date = new Date(item.createdAt);
    const key = calendar.format(date);
    let group = groups.find((entry) => entry.key === key);
    if (!group) {
      group = { key, label: key === calendar.format(now) ? "Today" : dayLabel.format(date), items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

/** The label changes with time without exposing a second description line. */
export function notificationTime(createdAt: string, now: number): string {
  const date = new Date(createdAt);
  const elapsed = Math.max(0, now - date.getTime());
  if (!Number.isFinite(elapsed)) return "";
  if (elapsed < 60_000) return "Now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} h`;
  return new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", timeZone: "Pacific/Auckland" }).format(date);
}
