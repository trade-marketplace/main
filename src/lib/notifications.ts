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
