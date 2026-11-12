import type { Metadata } from "next";

import { AccountSettings } from "@/components/account/AccountSettings";
import { TradesLoading } from "@/components/account/TradesLicences";
import { PayrollLoading } from "@/components/account/PayrollSettings";
import { PreferencesLoading } from "@/components/account/NotificationPreferences";
import { AppShellView } from "@/components/app/AppShellView";
import { TextLink } from "@/components/TextLink";
import { guardDevPage } from "@/server/dev-pages";
import account from "@/components/account/account.module.css";

import { WorkAreaDemo } from "../work-area/WorkAreaDemo";

export const metadata: Metadata = { title: "Account settings (dev)", robots: { index: false, follow: false } };

export default async function AccountSettingsPreview({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  guardDevPage();
  const state = (await searchParams).state;
  const back = state === "with-return" ? "/jobs?kind=bounty&distance=10" : null;
  const loading = state === "loading-trades" || state === "loading-payroll" || state === "loading-notifications";
  const active = state === "loading-trades" ? "/profile/trades" : state === "loading-payroll" ? "/profile/payroll" : state === "loading-notifications" ? "/profile/notifications" : "/profile/area";
  return <AppShellView viewer={{ role: "TRADIE", firstName: "Jack", lastName: "Wilson", email: "worker@demo.test", emailVerified: true, counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: "/profile/area", base: "/dev/components/account-settings" }}>
    <AccountSettings role="TRADIE" active={active} next={loading ? undefined : back}>
      {back && <TextLink href={back}>Back to jobs</TextLink>}
      {state === "loading-trades" ? <TradesLoading /> : state === "loading-payroll" ? <PayrollLoading /> : state === "loading-notifications" ? <><h1 className={account.title}>Notifications</h1><PreferencesLoading /></> : <WorkAreaDemo state="ready" network={false} />}
    </AccountSettings>
  </AppShellView>;
}
