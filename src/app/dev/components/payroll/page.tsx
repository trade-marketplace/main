import type { Metadata } from "next";
import { AccountSettings } from "@/components/account/AccountSettings";
import { PayrollLoadError, PayrollLoading } from "@/components/account/PayrollSettings";
import { AppShellView } from "@/components/app/AppShellView";
import { TextLink } from "@/components/TextLink";
import { boardSettingsRoute } from "@/lib/job-board";
import { guardDevPage } from "@/server/dev-pages";
import { PayrollDemo } from "./PayrollDemo";

export const metadata: Metadata = { title: "Bank & tax (dev)", robots: { index: false, follow: false } };
export default async function PayrollPreview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams; const state = typeof params.state === "string" ? params.state : "missing";
  const destination = boardSettingsRoute("/profile/payroll", params.next);
  return <AppShellView viewer={{ role: "TRADIE", firstName: "Jack", lastName: "Wilson", email: "jack@example.test", counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: "/profile/payroll", base: "/dev/components/payroll" }}>
    <AccountSettings role="TRADIE" active="/profile/payroll" next={destination.back}>
      {destination.back && <TextLink href={destination.back}>Back to jobs</TextLink>}
      {state === "loading" ? <PayrollLoading /> : state === "load-error" ? <PayrollLoadError next={destination.back} /> : <PayrollDemo state={state} />}
    </AccountSettings>
  </AppShellView>;
}
