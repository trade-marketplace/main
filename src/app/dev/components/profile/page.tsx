import type { Metadata } from "next";

import { AccountSettings } from "@/components/account/AccountSettings";
import { ProfileLoading } from "@/components/account/ProfileSettings";
import { AppShellView } from "@/components/app/AppShellView";
import { guardDevPage } from "@/server/dev-pages";

import { ProfileDemo } from "./ProfileDemo";

export const metadata: Metadata = { title: "Profile (dev)", robots: { index: false, follow: false } };

export default async function ProfilePreview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams;
  const role = params.mode === "trade" ? "TRADIE" : "CUSTOMER";
  const state = typeof params.state === "string" ? params.state : "";
  return <AppShellView viewer={{ role, firstName: "Sarah", lastName: "Thompson", email: "sarah@example.test", counts: { messages: 0, notifications: 0 } }} testMode
    preview={{ at: "/profile", base: "/dev/components/profile", menuOpen: params.menu === "open" }}>
    <AccountSettings role={role} active="/profile">{state === "loading" ? <ProfileLoading /> : <ProfileDemo state={state} />}</AccountSettings>
  </AppShellView>;
}
