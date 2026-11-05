import type { Metadata } from "next";
import { AppShellView } from "@/components/app/AppShellView";
import type { CustomerProblemState } from "@/lib/customer-problem";
import { guardDevPage } from "@/server/dev-pages";
import { ProblemDemo } from "./ProblemDemo";
export const metadata: Metadata = { title: "Report a problem (dev)", robots: { index: false, follow: false } };
const states = ["form", "loading", "empty", "error", "offline", "uploading", "saving", "sent", "urgent", "photos", "load-error", "completed-sent"] as const;
export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  guardDevPage();
  const { state } = await searchParams;
  const selected = states.includes(state as CustomerProblemState) ? state as typeof states[number] : "form";
  return <AppShellView viewer={{ role: "CUSTOMER", firstName: "Sarah", lastName: "Thompson", email: "preview@example.test", emailVerified: true, counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: "/jobs/18200000-0000-4000-8000-000000000001/problem", base: "/dev/components/customer-problem" }}><ProblemDemo key={selected} state={selected} /></AppShellView>;
}
