import type { Metadata } from "next";
import { AppShellView } from "@/components/app/AppShellView";
import { guardDevPage } from "@/server/dev-pages";
import { CancelJobDemo } from "./CancelJobDemo";

export const metadata: Metadata = { title: "Cancel job (dev)", robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  guardDevPage();
  const { state = "free" } = await searchParams;
  return <AppShellView viewer={{ role: "CUSTOMER", firstName: "Sarah", lastName: "Thompson", email: "customer@demo.test", emailVerified: true, counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: "/jobs/00000000-0000-4000-8000-000000000128", base: "/dev/components/cancel-job" }}>
    <CancelJobDemo key={state} state={state} />
  </AppShellView>;
}
