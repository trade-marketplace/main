import type { Metadata } from "next";
import { AccountSettings } from "@/components/account/AccountSettings";
import { AppShellView } from "@/components/app/AppShellView";
import { PAYMENT_STATES } from "@/lib/account/payments-list";
import { guardDevPage } from "@/server/dev-pages";
import { PaymentsDemo } from "./PaymentsDemo";

export const metadata: Metadata = { title: "Payments (dev)", robots: { index: false, follow: false } };
export default async function Preview({ searchParams }: { searchParams: Promise<{ state?: string; page?: string }> }) {
  guardDevPage();
  const params = await searchParams;
  const value = params.state;
  const state = PAYMENT_STATES.find(state => state === value) ?? "list";
  return <AppShellView viewer={{ role: "CUSTOMER", firstName: "Sarah", lastName: "Thompson", email: "customer@demo.test", counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: "/profile/payments", base: "/dev/components/payments-list" }}>
    <AccountSettings role="CUSTOMER" active="/profile/payments"><PaymentsDemo key={`${state}:${params.page}`} state={state} page={Number(params.page ?? 2)} /></AccountSettings>
  </AppShellView>;
}
