import type { Metadata } from "next";
import { AppShellView } from "@/components/app/AppShellView";
import { CustomerJobLoading, CustomerJobLoadError } from "@/components/jobs/CustomerJob";
import { guardDevPage } from "@/server/dev-pages";
import { exampleJob, VIEWERS } from "@/app/dev/components/job-views/preview-data";
import { customerJobView } from "@/server/views";
import { WaitingDemo } from "./WaitingDemo";
import { WaitingIssueNotice } from "@/components/jobs/CustomerWaitingActions";
import styles from "@/components/jobs/customer-job.module.css";

export const metadata: Metadata = { title: "Getting your price (dev)", robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams, state = typeof params.state === "string" ? params.state : "ready";
  const job = customerJobView(VIEWERS.customer, exampleJob({ status: "REVIEW", workerId: null, worker: null }))!;
  return <AppShellView viewer={{ role: "CUSTOMER", firstName: "Sarah", lastName: "Thompson", email: "customer@demo.test", emailVerified: true, counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: `/jobs/${job.id}`, base: "/dev/components/customer-job-waiting" }}>
    {state === "recovery-gallery" ? <section className={styles.page} data-mode="customer"><div className={`${styles.wrap} ${styles.details}`}><h1 className={styles.title}>Getting your price · recovery states</h1><div className={styles.editForm}>
      {(["edit", "cancel", "changed"] as const).map(kind => <div key={kind} className={styles.card}><h2 className={styles.heading}>{kind === "cancel" ? "Cancel job" : kind === "edit" ? "Edit job" : "Job updated"}</h2><WaitingIssueNotice kind={kind} /></div>)}
    </div></div></section> : state === "loading" ? <CustomerJobLoading /> : state === "load-error" ? <CustomerJobLoadError /> : <WaitingDemo initial={job} state={state} />}
  </AppShellView>;
}
