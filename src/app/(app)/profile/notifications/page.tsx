import type { Metadata } from "next";

import { AccountSettings } from "@/components/account/AccountSettings";
import { NotificationPreferences } from "@/components/account/NotificationPreferences";
import { TextLink } from "@/components/TextLink";
import { boardReturn } from "@/lib/job-board";
import { privateMetadata } from "@/lib/metadata";
import { requireRole } from "@/server/auth/guard";
import { loadPreferencesAction } from "@/server/notifications/preference-actions";

export const metadata: Metadata = { ...privateMetadata, title: "Notifications" };

export default async function NotificationPreferencesPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = (await searchParams).next;
  const viewer = await requireRole(["CUSTOMER", "TRADIE"], { next: "/profile/notifications" });
  return <AccountSettings role={viewer.role === "TRADIE" ? "TRADIE" : "CUSTOMER"} active="/profile/notifications">
    {viewer.role === "TRADIE" && next?.startsWith("/jobs") && <TextLink href={boardReturn(next)}>Back to jobs</TextLink>}
    <NotificationPreferences initial={await loadPreferencesAction()} />
  </AccountSettings>;
}
