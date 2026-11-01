import type { Metadata } from "next";

import { NotificationsPage } from "@/components/notifications/NotificationsPage";
import { privateMetadata } from "@/lib/metadata";
import { notificationsHref, notificationsQuery, type NotificationsResult } from "@/lib/notifications";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { loadNotificationsPage } from "@/server/notifications/inbox";

export const metadata: Metadata = { ...privateMetadata, title: "Notifications" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = notificationsQuery(await searchParams);
  const viewer = await requireRole(["CUSTOMER", "TRADIE"], { next: notificationsHref(query) });
  let initial: NotificationsResult;
  try { initial = { ok: true, inbox: await loadNotificationsPage(getDb(), viewer.userId, query) }; }
  catch { console.error("Notification page unavailable"); initial = { ok: false, error: "unavailable" }; }
  return <NotificationsPage query={query} initial={initial} />;
}
