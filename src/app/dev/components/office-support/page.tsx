import type { Metadata } from "next";
import { OfficeShellView } from "@/components/office/OfficeShellView";
import { AppShellView } from "@/components/app/AppShellView";
import { guardDevPage } from "@/server/dev-pages";
import { OwnerPreview, SupportPreview } from "./Preview";
import { OFFICE_SUPPORT_STATES, type OfficeSupportState } from "./preview-data";

export const metadata: Metadata = { title: "Support inbox (dev)", robots: { index: false, follow: false } };
export default async function Preview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams, candidate = params.state;
  const state: OfficeSupportState = typeof candidate === "string" && (OFFICE_SUPPORT_STATES as readonly string[]).includes(candidate) ? candidate as OfficeSupportState : "inbox";
  if (state === "owner") return <AppShellView viewer={{ role: "CUSTOMER", firstName: "Sarah", lastName: "Thomas", email: "customer@demo.test", emailVerified: true, counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: "/help", base: "/dev/components/office-support" }}><OwnerPreview /></AppShellView>;
  return <OfficeShellView viewer={{ role: "ADMIN", firstName: "Matt", lastName: "Larsen", email: "office@demo.test" }} counts={{ support: 28, queues: 0, tradies: 0 }} testMode preview={{ at: "/admin/support", base: "/dev/components/office-support" }}>
    <SupportPreview key={state} state={state} />
  </OfficeShellView>;
}
