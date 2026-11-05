import type { Metadata } from "next";
import { AppShellView } from "@/components/app/AppShellView";
import { CustomerJobs } from "@/components/jobs/CustomerJobs";
import { parseCustomerJobsQuery } from "@/lib/customer-jobs";
import { guardDevPage } from "@/server/dev-pages";
import { previewCustomerJobs } from "./preview-data";

export const metadata: Metadata = { title: "My jobs (dev)", robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams, query = parseCustomerJobsQuery(params), state = typeof params.state === "string" ? params.state : "jobs";
  return <AppShellView viewer={{ role: "CUSTOMER", firstName: "Sarah", lastName: "Thompson", email: "customer@example.test", emailVerified: true, counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: "/dashboard", base: "/dev/components/customer-jobs" }}><CustomerJobs query={query} data={state === "error" ? null : previewCustomerJobs(state, query)} loading={state === "loading"} previewOffline={state === "offline"} basePath={`/dev/components/customer-jobs?state=${encodeURIComponent(state)}`} /></AppShellView>;
}
