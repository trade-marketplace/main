"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AppShellView } from "@/components/app/AppShellView";
import { SessionExpiredProvider } from "@/components/auth/SessionExpired";
import { NotificationInboxProvider } from "@/components/notifications/NotificationInbox";
import { NotificationsPage } from "@/components/notifications/NotificationsPage";
import { NOTIFICATIONS_PAGE_SIZE, type InboxItem, type InboxSource, type NotificationsQuery, type NotificationsSource } from "@/lib/notifications";

const NOW = Date.UTC(2026, 9, 30, 0);
const BASE = "/dev/components/notifications-page";

function snapshot(items: InboxItem[], request: NotificationsQuery) {
  const filtered = items.filter((item) => request.filter !== "unread" || item.readAt === null);
  const page = Math.min(request.page, Math.max(1, Math.ceil(filtered.length / NOTIFICATIONS_PAGE_SIZE)));
  return { items: structuredClone(filtered.slice((page - 1) * NOTIFICATIONS_PAGE_SIZE, page * NOTIFICATIONS_PAGE_SIZE)), page, total: filtered.length, unread: items.filter((item) => item.readAt === null).length };
}

function examples(state: string): InboxItem[] {
  if (state === "empty") return [];
  return Array.from({ length: state === "many" ? 31 : 4 }, (_, i) => {
    const [line, icon, href] = [
      ["Your price is ready · Sub wiring", "sell", "/jobs/TM-1005"],
      ["Jack sent a message", "chat_bubble", "/messages/TM-1005"],
      ["Fence palings are finished. Please check.", "task_alt", "/jobs/TM-1004"],
      ["Receipt for TM-0998", "receipt_long", "/receipts/TM-0998"],
    ][i % 4];
    return { id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, line: state === "long" && i === 0 ? `${line} — Replace the entire back boundary fence beside the garage and the unusually long shared driveway` : line,
      icon, href, createdAt: new Date(NOW - (i < 2 ? (5 + i * 4) * 60_000 : i * 86_400_000)).toISOString(), readAt: state === "read" || i % 4 > 1 ? new Date(NOW).toISOString() : null };
  });
}

/** Guarded synthetic review data: no database, auth provider, or external request. */
export function NotificationsDemo({ state, role, query }: { state: string; role: "CUSTOMER" | "TRADIE"; query: NotificationsQuery }) {
  useEffect(() => {
    const previous = document.documentElement.dataset.mode;
    document.documentElement.dataset.mode = role === "TRADIE" ? "trade" : "customer";
    return () => { document.documentElement.dataset.mode = previous; };
  }, [role]);
  const [seed, setSeed] = useState(() => examples(state));
  const items = useRef(seed);
  const signedIn = useRef(state !== "expired");
  const failRead = useRef(state === "read-error");
  const source = useMemo<NotificationsSource>(() => ({
    load: async (request) => ({ ok: true, inbox: snapshot(items.current, request) }),
    read: async (id, request) => {
      if (!signedIn.current) return { ok: false, error: "session-expired" };
      await new Promise((resolve) => setTimeout(resolve, state === "saving" ? 30_000 : 250));
      if (failRead.current) { failRead.current = false; return { ok: false, error: "unavailable" }; }
      items.current = items.current.map((item) => id === null || item.id === id ? { ...item, readAt: item.readAt ?? new Date(NOW).toISOString() } : item);
      setSeed(items.current);
      return { ok: true, inbox: snapshot(items.current, request) };
    },
  }), [state]);
  const bellSource = useMemo<InboxSource>(() => ({
    load: async () => ({ ok: true, inbox: { items: structuredClone(items.current.slice(0, 8)), unread: items.current.filter((item) => item.readAt === null).length } }),
    read: async (id) => source.read(id, { filter: "all", page: 1 }),
  }), [source]);
  const initial = useMemo(() => snapshot(seed, query), [seed, query]);
  const extra = new URLSearchParams({ state, ...(role === "TRADIE" ? { mode: "trade" } : {}) }).toString();
  const email = `${role.toLowerCase()}@example.test`;
  return <SessionExpiredProvider email={email} role={role} logIn={async () => { signedIn.current = true; return { ok: true, role, redirectTo: "/notifications" }; }}>
    <NotificationInboxProvider count={initial.unread} source={bellSource} initialInbox={{ items: seed.slice(0, 8), unread: initial.unread }} now={NOW}>
      <AppShellView viewer={{ role, firstName: role === "TRADIE" ? "Jack" : "Sarah", lastName: null, email, emailVerified: true, counts: { messages: 0, notifications: initial.unread } }} testMode={false} preview={{ at: "/notifications", base: BASE }}>
        <NotificationsPage initial={state === "error" ? { ok: false, error: "unavailable" } : { ok: true, inbox: initial }} query={query} source={source} now={NOW} baseHref={BASE} extraQuery={extra} loading={state === "loading"} online={state === "offline" ? false : undefined} />
      </AppShellView>
    </NotificationInboxProvider>
  </SessionExpiredProvider>;
}
