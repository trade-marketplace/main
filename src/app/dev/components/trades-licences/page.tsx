import type { Metadata } from "next";
import { AccountSettings } from "@/components/account/AccountSettings";
import { TradesLoading } from "@/components/account/TradesLicences";
import { AppShellView } from "@/components/app/AppShellView";
import type { TradeSnapshot } from "@/lib/account/trades";
import { guardDevPage } from "@/server/dev-pages";
import { TradesDemo } from "./TradesDemo";

export const metadata: Metadata = { title: "Trades & licences (dev)", robots: { index: false, follow: false } };
export default async function Preview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams; const state = typeof params.state === "string" ? params.state : "all-checked";
  const snapshot: TradeSnapshot = { today: "2026-11-04", rows: [
    { trade: "ELECTRICAL", licence: { id: "demo-electrical", number: "E 123456", status: "VERIFIED", expiresOn: state === "expiring" ? "2026-11-20" : state === "expired" ? "2026-11-03" : "2027-03-31", rejectionReason: null, hasDocument: true } },
    { trade: "PLUMBING", licence: { id: "demo-plumbing", number: "PGDB 98211", status: state === "rejected" || state === "save-error" ? "REJECTED" : state === "checking" ? "PENDING" : "VERIFIED", expiresOn: "2027-03-31", rejectionReason: state === "rejected" || state === "save-error" ? "Licence photo was unreadable" : null, hasDocument: true } },
    { trade: "OTHER", licence: null },
  ] };
  return <AppShellView viewer={{ role: "TRADIE", firstName: "Jack", lastName: "Wilson", email: "jack@example.test", counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: "/profile/trades", base: "/dev/components/trades-licences" }}>
    <AccountSettings role="TRADIE" active="/profile/trades">{state === "loading" ? <TradesLoading /> : <TradesDemo snapshot={snapshot} state={state} />}</AccountSettings>
  </AppShellView>;
}
