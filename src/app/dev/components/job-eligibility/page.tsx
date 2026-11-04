import type { Metadata } from "next";
import Link from "next/link";
import { AppShellView } from "@/components/app/AppShellView";
import { Pill } from "@/components/status/Pill";
import { guardDevPage } from "@/server/dev-pages";
import { canClaim, canEstimate, eligibilityFailure, eligibleJobsFor } from "@/server/workers/eligibility";
import { ELIGIBILITY_STATES, eligibilityExample, PREVIEW_NOW } from "./preview-data";
import styles from "./preview.module.css";

export const metadata: Metadata = { title: "Job eligibility (dev)", robots: { index: false, follow: false } };
export default async function JobEligibilityPreview({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  guardDevPage();
  const params = await searchParams;
  const state = ELIGIBILITY_STATES.find(value => value === params.state) ?? "ready";
  const { worker, jobs } = eligibilityExample(state), context = { now: PREVIEW_NOW };
  const ids = eligibleJobsFor(worker, jobs, context);
  return <AppShellView viewer={{ role: "TRADIE", firstName: "Jack", lastName: "Wilson", email: "worker@demo.test", counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: "/jobs", base: `/dev/components/job-eligibility?state=${state}` }}>
    <div className={styles.surface}><div className={styles.page}>
      <h1>Job eligibility</h1><p className={styles.note}>Development preview · example data</p>
      <nav className={styles.states} aria-label="Eligibility state">{ELIGIBILITY_STATES.map(value => <Link key={value} href={`?state=${value}`} aria-current={state === value ? "page" : undefined}>{value.replaceAll("-", " ")}</Link>)}</nav>
      <section className={styles.summary} aria-label="Eligible jobs"><h2>Eligible jobs <span>{ids.length}</span></h2>
        {ids.length ? <ul>{jobs.filter(job => ids.includes(job.id)).map(job => <li key={job.id}><Link href={`?state=${state}#job-${job.id}`}>{job.title}</Link></li>)}</ul> : <p>Not eligible</p>}
      </section>
      <div className={styles.grid}>{jobs.map(job => {
        const claim = canClaim(worker, job, context), estimate = canEstimate(worker, job, context);
        const reason = eligibilityFailure(worker, job, "discover", context);
        return <section key={job.id} id={`job-${job.id}`} className={styles.card} aria-label={job.title}>
          <h2>{job.title}</h2><p className={styles.note}>{job.category === "OTHER" ? "Other" : "Electrical"} · {job.suburb}</p>
          <Pill kind={claim ? "action" : "waiting"}>{claim ? "Ready to claim" : estimate ? "Needs a quote" : "Not eligible"}</Pill>
          <dl><div><dt>Claim</dt><dd>{claim ? "Allowed" : "Not eligible"}</dd></div><div><dt>Estimate</dt><dd>{estimate ? "Allowed" : "Not eligible"}</dd></div></dl>
          {reason && <code className={styles.reason}>{reason}</code>}
        </section>;
      })}</div>
    </div></div>
  </AppShellView>;
}
