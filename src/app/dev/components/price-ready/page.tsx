import type { Metadata } from "next";
import { AppShellView } from "@/components/app/AppShellView";
import { CustomerJobLoading, CustomerJobLoadError } from "@/components/jobs/CustomerJob";
import { exampleJob, VIEWERS } from "@/app/dev/components/job-views/preview-data";
import { customerJobView } from "@/server/views";
import { guardDevPage } from "@/server/dev-pages";
import { PriceReadyDemo } from "./PriceReadyDemo";

export const metadata: Metadata = { title: "Price ready (dev)", robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  guardDevPage();
  const { state = "ready" } = await searchParams;
  const job = customerJobView(VIEWERS.customer, exampleJob({ status: "PRICED", workerId: null, worker: null, bookedDate: null, bookedTime: null, ...(state === "other-trade" ? { category: "PLUMBING" } : {}) }))!;
  return <AppShellView viewer={{ role: "CUSTOMER", firstName: "Sarah", lastName: "Thompson", email: "customer@demo.test", emailVerified: true, counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: `/jobs/${job.id}`, base: "/dev/components/price-ready" }}>
    {state === "loading" ? <CustomerJobLoading /> : state === "error" ? <CustomerJobLoadError /> : <PriceReadyDemo key={state} initial={job} state={state} />}
  </AppShellView>;
}
