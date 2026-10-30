import type { Metadata } from "next";

import { AccountSettings } from "@/components/account/AccountSettings";
import { NotificationPreferences } from "@/components/account/NotificationPreferences";
import { privateMetadata } from "@/lib/metadata";
import { requireRole } from "@/server/auth/guard";
import { loadPreferencesAction } from "@/server/notifications/preference-actions";

export const metadata: Metadata = { ...privateMetadata, title: "Notifications" };

export default async function NotificationPreferencesPage() {
  const viewer = await requireRole(["CUSTOMER", "TRADIE"], { next: "/profile/notifications" });
  return <AccountSettings role={viewer.role === "TRADIE" ? "TRADIE" : "CUSTOMER"} active="/profile/notifications">
    <NotificationPreferences initial={await loadPreferencesAction()} />
  </AccountSettings>;
}
