import type { Metadata } from "next";
import { NotificationsPage } from "@/components/notifications/NotificationsPage";
import { OFFICE_NOTIFICATIONS_PATH } from "@/components/office/office-links";
import { privateMetadata } from "@/lib/metadata";
import { notificationsHref, notificationsQuery } from "@/lib/notifications";
import { requireRole } from "@/server/auth/guard";
import { loadOfficeNotifications, readOfficeNotifications } from "./actions";

export const metadata: Metadata = { ...privateMetadata, title: "Notifications" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = notificationsQuery(await searchParams);
  await requireRole(["ADMIN"], { next: notificationsHref(query, OFFICE_NOTIFICATIONS_PATH) });
  return <NotificationsPage query={query} initial={await loadOfficeNotifications(query)} baseHref={OFFICE_NOTIFICATIONS_PATH}
    source={{ load: loadOfficeNotifications, read: readOfficeNotifications }} />;
}
