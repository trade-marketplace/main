import type { Metadata } from "next";
import { AppShellView } from "@/components/app/AppShellView";
import { guardDevPage } from "@/server/dev-pages";
import { exampleJob, VIEWERS } from "@/app/dev/components/job-views/preview-data";
import { customerJobView } from "@/server/views";
import { ExtraWorkDemo } from "./ExtraWorkDemo";

export const metadata: Metadata = { title: "Extra work (dev)", robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  guardDevPage();
  const { state = "dialog" } = await searchParams;
  const job = customerJobView(VIEWERS.customer, exampleJob())!;
  return <AppShellView viewer={{ role: "CUSTOMER", firstName: "Sarah", lastName: "Thompson", email: "customer@demo.test", emailVerified: true, counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: `/jobs/${job.id}`, base: "/dev/components/extra-work" }}>
    <ExtraWorkDemo key={state} job={job} state={state} />
  </AppShellView>;
}
