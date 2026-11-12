import type { Metadata } from "next";

import { AccountSettings } from "@/components/account/AccountSettings";
import { AppShellView } from "@/components/app/AppShellView";
import { TextLink } from "@/components/TextLink";
import { guardDevPage } from "@/server/dev-pages";

import { WorkAreaDemo } from "../work-area/WorkAreaDemo";

export const metadata: Metadata = { title: "Account settings (dev)", robots: { index: false, follow: false } };

export default async function AccountSettingsPreview({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  guardDevPage();
  const back = (await searchParams).state === "with-return" ? "/jobs?kind=bounty&distance=10" : null;
  return <AppShellView viewer={{ role: "TRADIE", firstName: "Jack", lastName: "Wilson", email: "worker@demo.test", emailVerified: true, counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: "/profile/area", base: "/dev/components/account-settings" }}>
    <AccountSettings role="TRADIE" active="/profile/area" next={back}>
      {back && <TextLink href={back}>Back to jobs</TextLink>}
      <WorkAreaDemo state="ready" network={false} />
    </AccountSettings>
  </AppShellView>;
}
