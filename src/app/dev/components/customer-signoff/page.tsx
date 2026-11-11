import type { Metadata } from "next";
import { AppShellView } from "@/components/app/AppShellView";
import { CustomerJobLoading } from "@/components/jobs/CustomerJob";
import { exampleJob, VIEWERS } from "@/app/dev/components/job-views/preview-data";
import { customerJobView } from "@/server/views";
import { guardDevPage } from "@/server/dev-pages";
import type { CustomerSignoff } from "@/lib/customer-signoff";
import { SignoffDemo } from "./SignoffDemo";
import styles from "@/components/jobs/customer/signoff.module.css";

export const metadata: Metadata = { title: "Please check (dev)", robots: { index: false, follow: false } };
function Demo({ state, now: currentTime, suffix = "1" }: { state: string; now: string; suffix?: string }) {
  if (state === "loading") return <CustomerJobLoading />;
  const source = exampleJob({ id: `12900000-0000-4000-8000-${suffix.padStart(12, "0")}`, ...(suffix !== "1" ? { title: `Sub wiring · ${state}`, jobNumber: 1005 + Number(suffix) } : {}), status: state === "auto-completed" ? "COMPLETED" : "SUBMITTED", category: state === "photos" ? "OTHER" : "ELECTRICAL" });
  const job = customerJobView(VIEWERS.customer, source)!, now = new Date(currentTime).getTime(), hours = state === "hours-left" ? 46 : 48;
  const filesUnavailable = state === "files-unavailable", empty = state === "empty";
  const data: CustomerSignoff | null = state === "load-error" ? null : {
    cocNumber: state === "photos" || empty ? null : "2026-118734", cocUrl: filesUnavailable || empty || state === "photos" ? null : state === "certificate-photo" ? "/images/examples/modules.jpg" : "/dev/components/customer-signoff/certificate", cocFileLabel: state === "certificate-photo" ? "Photo" : "PDF",
    photos: empty ? [] : ["modules", "switch"].map((name, index) => ({ id: `finished-${suffix}-${index}`, url: filesUnavailable ? null : `/images/examples/${name}.jpg` })),
    notes: empty ? null : "All done. The switch and wiring are secure.", submittedAt: empty ? null : new Date(now - (48 - hours) * 3_600_000).toISOString(),
    hoursLeft: empty ? null : hours, releaseAt: empty ? null : new Date(now + hours * 3_600_000).toISOString(), problemOpen: state === "paused", autoCompleted: state === "auto-completed", filesUnavailable, filesRenewAfterMs: 270000,
  };
  return <SignoffDemo job={job} data={data} state={state} />;
}

export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  guardDevPage();
  const { state = "electrical" } = await searchParams;
  const now = new Date().toISOString();
  return <AppShellView viewer={{ role: "CUSTOMER", firstName: "Sarah", lastName: "Thompson", email: "customer@demo.test", emailVerified: true, counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: "/jobs/12900000-0000-4000-8000-000000000001", base: "/dev/components/customer-signoff" }}>
    {state === "recovery" ? <div className={styles.gallery}>{["certificate-photo", "empty", "load-error", "loading"].map((item, index) => <section key={item} aria-labelledby={`signoff-${item}`}><h1 id={`signoff-${item}`}>{item}</h1><Demo state={item} now={now} suffix={String(index + 20)} /></section>)}</div> : <Demo state={state} now={now} />}
  </AppShellView>;
}
