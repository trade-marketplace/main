import type { Metadata } from "next";
import { guardDevPage } from "@/server/dev-pages";
import { AppShellView } from "@/components/app/AppShellView";
import { ProblemThreadsDemo } from "./ProblemThreadsDemo";

export const metadata: Metadata = { title: "Problem threads (dev)", robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams;
  const trade = params.mode === "trade";
  return <AppShellView viewer={{ role: trade ? "TRADIE" : "CUSTOMER", firstName: trade ? "Jack" : "Sarah", lastName: "Thompson", email: "preview@example.test", emailVerified: true, counts: { messages: 1, notifications: 0 } }} testMode
    preview={{ at: "/messages", base: "/dev/components/problem-threads" }}>
    <ProblemThreadsDemo key={`${params.state}-${params.thread}-${params.mode}`} state={typeof params.state === "string" ? params.state : "thread"} second={params.thread === "second"} trade={trade} />
  </AppShellView>;
}
