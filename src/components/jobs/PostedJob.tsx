"use client";
import { Button } from "@/components/Button";
import { BoltFlash } from "@/components/motion/BoltFlash";
import { Tracker } from "@/components/status/Tracker";
import { StatusPill } from "@/components/status/StatusPill";
import { jobTracker } from "@/lib/job-tracker";
import type { FirebaseWebConfig, PushCardState } from "@/lib/browser-push";
import type { CustomerJobView } from "@/server/views";
import { PushOptIn } from "./PushOptIn";
import styles from "./posted-job.module.css";

export function PostedJob({ job, ownerId, push, previewState }: { job: CustomerJobView; ownerId: string; push: FirebaseWebConfig | null; previewState?: PushCardState | "hidden" }) {
  const titleId = `posted-${job.id}`;
  const statusId = `posted-status-${job.id}`;
  const tracker = jobTracker(job.status, "customer", { tradieName: job.worker?.firstName });
  const lead = job.status === "REVIEW" ? "We’re on it. We’ll let you know when your price is ready." : tracker?.steps[tracker.current]?.note ?? tracker?.steps[tracker.current]?.label;
  return <section className={styles.page} data-mode="customer" aria-labelledby={job.status === "REVIEW" ? titleId : `${titleId} ${statusId}`}>
    <div className={styles.card}>
      <div className={styles.celebration}><BoltFlash eventId={`posted:${job.id}`} mark="check" size={110} /></div>
      <h1 id={titleId} className={styles.title}>Posted.</h1>
      {lead && <p className={styles.lead}>{lead}</p>}
      {job.status !== "REVIEW" && <span id={statusId}><StatusPill status={job.status} audience="customer" /></span>}
      {tracker && <div className={styles.tracker}><Tracker {...tracker} /></div>}
      {(job.status === "REVIEW" || job.status === "QUOTE_BOUNTY") && previewState !== "hidden" && <PushOptIn key={ownerId} ownerId={ownerId} config={push} previewState={previewState} />}
      <Button href={`/jobs/${job.id}`} width="full" variant="hero">View my job</Button>
    </div>
  </section>;
}

/** The existing #95 allowlist powers the real View-my-job destination; C07 controls remain a separate issue. */
export function CustomerJobSummary({ job }: { job: CustomerJobView }) {
  const tracker = jobTracker(job.status, "customer", { tradieName: job.worker?.firstName });
  const date = new Intl.DateTimeFormat("en-NZ", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
  const windows = job.bookedDate && job.bookedTime ? [{ date: job.bookedDate, timeOfDay: job.bookedTime }] : job.timeWindows;
  return <section className={styles.page} data-mode="customer" aria-labelledby="job-title"><div className={`${styles.card} ${styles.detail}`}>
    <p className={styles.reference}>TM-{job.jobNumber}</p><StatusPill status={job.status} audience="customer" />
    <h1 id="job-title" className={styles.jobTitle}>{job.title}</h1><p className={styles.description}>{job.description}</p>
    <h2>Address</h2><p>{[job.address?.line2, job.address?.line1, job.suburb, job.city, job.address?.postcode].filter(Boolean).join(", ")}</p>
    {job.address?.accessNotes && <p className={styles.description}>{job.address.accessNotes}</p>}
    <h2>Where &amp; when</h2>{job.asap && <p>ASAP</p>}{!job.bookedDate && job.anyTime ? <p>Any time</p> : windows.length ? <ul className={styles.windows}>{windows.map(window => <li key={`${window.date}/${window.timeOfDay}`}>{date.format(new Date(`${window.date}T00:00:00Z`))} · {window.timeOfDay === "MORNING" ? "Morning" : window.timeOfDay === "AFTERNOON" ? "Afternoon" : "Evening"}</li>)}</ul> : <p>Time to be arranged</p>}
    {job.priceCents !== null && <div className={styles.price}><span>Total incl GST</span><strong>{new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(job.priceCents / 100)}</strong></div>}
    {tracker && <Tracker {...tracker} />}<Button href="/" variant="secondary">Home</Button>
  </div></section>;
}
