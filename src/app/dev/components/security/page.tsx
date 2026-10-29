import type { Metadata } from "next";

import { AccountSettings } from "@/components/account/AccountSettings";
import { SecurityLoading } from "@/components/account/SecurityLoading";
import { AppShellView } from "@/components/app/AppShellView";
import { guardDevPage } from "@/server/dev-pages";

import { SecurityDemo } from "./SecurityDemo";

export const metadata: Metadata = { title: "Security (dev)", robots: { index: false, follow: false } };

export default async function SecurityPreview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams;
  const role = params.mode === "trade" ? "TRADIE" : "CUSTOMER";
  const state = typeof params.state === "string" ? params.state : "";
  return <AppShellView viewer={{ role, firstName: "Sarah", lastName: "Thompson", email: "sarah@example.test", counts: { messages: 0, notifications: 0 } }} testMode
    preview={{ at: "/profile/security", base: "/dev/components/security", menuOpen: params.menu === "open" }}>
    <AccountSettings role={role}>{state === "loading" ? <SecurityLoading /> : <SecurityDemo state={state} />}</AccountSettings>
  </AppShellView>;
}
