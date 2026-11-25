"use client";

import { useState } from "react";
import { NotificationsPage } from "@/components/notifications/NotificationsPage";
import { OfficeShellView } from "@/components/office/OfficeShellView";
import { OFFICE_NOTIFICATIONS_PATH } from "@/components/office/office-links";
import type { InboxItem, NotificationsQuery, NotificationsSource } from "@/lib/notifications";

const BASE = "/dev/components/office-notifications";
const DATE = "2026-11-23T00:00:00Z";
const item: InboxItem = { id: "00000000-0000-4000-8000-000000000001", icon: "add_circle", line: "Extra work requested",
  href: "/admin/jobs", createdAt: DATE, readAt: null };

export function OfficeInboxPreview({ state, query }: { state: string; query: NotificationsQuery }) {
  const [entries, setEntries] = useState(state === "empty" ? [] : [item]);
  const snapshot = (rows: InboxItem[], request: NotificationsQuery) => {
    const unread = rows.filter(row => !row.readAt);
    const items = request.filter === "unread" ? unread : rows;
    return { unread: unread.length, total: items.length, page: 1, items };
  };
  const source: NotificationsSource = {
    load: async request => ({ ok: true, inbox: snapshot(entries, request) }),
    read: async (id, request) => {
      const next = entries.map(row => !id || id === row.id ? { ...row, readAt: DATE } : row);
      setEntries(next);
      return { ok: true, inbox: snapshot(next, request) };
    },
  };
  const inbox = snapshot(entries, query);
  const viewer = { role: "ADMIN" as const, firstName: "Matt", lastName: null, email: "office@example.test", unreadNotifications: inbox.unread };
  return <OfficeShellView viewer={viewer} testMode preview={{ at: OFFICE_NOTIFICATIONS_PATH, base: BASE }}>
    <NotificationsPage initial={state === "error" ? { ok: false, error: "unavailable" } : { ok: true, inbox }}
      query={query} source={source} baseHref={BASE} extraQuery={new URLSearchParams({ state }).toString()}
      now={Date.parse(DATE)} loading={state === "loading"} online={state !== "offline"} />
  </OfficeShellView>;
}
