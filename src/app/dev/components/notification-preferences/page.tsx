import type { Metadata } from "next";

import { AccountSettings } from "@/components/account/AccountSettings";
import { AppShellView } from "@/components/app/AppShellView";
import { guardDevPage } from "@/server/dev-pages";

import { PreferencesDemo } from "./PreferencesDemo";

export const metadata: Metadata = { title: "Notification preferences (dev)", robots: { index: false, follow: false } };

export default async function PreferencesPreview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams;
  const role = params.mode === "trade" ? "TRADIE" : "CUSTOMER";
  return <AppShellView viewer={{ role, firstName: "Sarah", lastName: "Thompson", email: "sarah@example.test", counts: { messages: 0, notifications: 0 } }} testMode
    preview={{ at: "/profile/notifications", base: "/dev/components/notification-preferences" }}>
    <AccountSettings role={role} active="/profile/notifications"><PreferencesDemo role={role} state={typeof params.state === "string" ? params.state : ""} /></AccountSettings>
  </AppShellView>;
}
