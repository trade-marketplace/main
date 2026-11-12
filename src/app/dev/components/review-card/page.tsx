import type { Metadata } from "next";
import { AppShellView } from "@/components/app/AppShellView";
import { guardDevPage } from "@/server/dev-pages";
import { ReviewDemo } from "./ReviewDemo";

export const metadata: Metadata = { title: "Your review (dev)", robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  guardDevPage();
  const { state = "none" } = await searchParams;
  return <AppShellView viewer={{ role: "CUSTOMER", firstName: "Sarah", lastName: "Thompson", email: "customer@demo.test", emailVerified: true, counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: "/jobs/00000000-0000-4000-8000-000000000130", base: "/dev/components/review-card" }}>
    <ReviewDemo key={state} state={state} now={Date.parse("2026-11-12T00:00:00Z")} />
  </AppShellView>;
}
