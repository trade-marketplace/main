import type { Metadata } from "next";
import { AppShellView } from "@/components/app/AppShellView";
import { CustomerJob, CustomerJobLoadError, CustomerJobLoading } from "@/components/jobs/CustomerJob";
import { guardDevPage } from "@/server/dev-pages";
import { exampleJob, VIEWERS } from "@/app/dev/components/job-views/preview-data";
import { customerJobView } from "@/server/views";

export const metadata: Metadata = { title: "Customer job (dev)", robots: { index: false, follow: false } };
const statuses = { ready: "REVIEW", "quick-look": "QUOTE_BOUNTY", priced: "PRICED", booked: "BOOKABLE", assigned: "ASSIGNED", submitted: "SUBMITTED", completed: "COMPLETED", "cancel-requested": "CANCEL_REVIEW", cancelled: "CANCELLED" } as const;
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams;
  const state = typeof params.state === "string" ? params.state : "ready";
  const status = statuses[state as keyof typeof statuses] ?? "REVIEW";
  const job = customerJobView(VIEWERS.customer, exampleJob({ status }))!;
  if (state === "empty") { job.photos = []; job.address.accessNotes = null; job.anyTime = false; job.asap = false; job.timeWindows = []; job.bookedDate = null; job.bookedTime = null; }
  if (state === "long") { job.title = "A very long job title with enough detail to wrap comfortably on a small phone"; job.description = "LongUnbrokenDescription".repeat(12); job.address.line1 = "A long address that still needs to fit safely inside its card"; job.address.accessNotes = "Access notes ".repeat(25); }
  const photos = state === "empty" ? [] : ["wires", "switch", "board"].map((name, index) => ({ src: `/images/examples/${name}.jpg`, alt: `${job.title} · ${index + 1}` }));
  return <AppShellView viewer={{ role: "CUSTOMER", firstName: "Sarah", lastName: "Thompson", email: "customer@demo.test", emailVerified: true, counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: `/jobs/${job.id}`, base: "/dev/components/customer-job" }}>
    {state === "status-gallery" ? Object.values(statuses).map((status, index) => {
      const example = customerJobView(VIEWERS.customer, exampleJob({ status, id: `12200000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, jobNumber: 1005 + index }))!;
      return <CustomerJob key={status} job={example} photos={photos} preview="static" />;
    }) : state === "loading" ? <CustomerJobLoading /> : state === "error" ? <CustomerJobLoadError /> : <CustomerJob job={job} photos={photos} photosFailed={state === "photos-error"} preview={state === "offline" ? "offline" : "static"} />}
  </AppShellView>;
}
