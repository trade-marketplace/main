"use client";
import { useState } from "react";
import { TextLink } from "@/components/TextLink";
import { WorkerEstimateFields, WorkerEstimateNotice, WorkerEstimateSummary } from "@/components/jobs/WorkerEstimateParts";
import { estimateFields, type EstimateFields } from "@/lib/worker-estimate";
import type { WorkerJobView } from "@/server/views/jobs";
import styles from "@/components/jobs/worker-estimate.module.css";

/** Bot galleries use the production fragments once per visible variant, inside the one app shell. */
export function EstimateVariants({ job, eligibility }: { job: WorkerJobView; eligibility?: boolean }) {
  const own = job.ownEstimate!;
  const [value, setValue] = useState(() => estimateFields(own));
  function change<K extends keyof EstimateFields>(key: K, next: EstimateFields[K]) { setValue(previous => ({ ...previous, [key]: next })); }
  const fields = { hours: "Use half-hour steps from 0.5 to 40." };
  return <section className={styles.canvas} data-mode="trade"><div className={styles.page}>
    <TextLink href="/dev/components/worker-estimate?state=ready">Back to job</TextLink>
    <h1 className={styles.title}>{eligibility ? "Estimate eligibility" : "Your estimate"}</h1>
    {eligibility ? <div className={styles.variantGrid}>
      <section className={styles.card} aria-label="Not verified"><h2>Not verified</h2><WorkerEstimateNotice failure="identity-required" /></section>
      <section className={styles.card} aria-label="Wrong trade"><h2>Wrong trade</h2><WorkerEstimateNotice failure="trade-mismatch" /></section>
    </div> : <>
      <div className={styles.variantGrid}>
        <section className={styles.card} aria-label="Already estimated"><h2>Already estimated</h2><WorkerEstimateSummary own={own} /><TextLink href="/dev/components/worker-estimate?state=estimated">Edit</TextLink></section>
        <section className={styles.card} aria-label="Job edited"><h2>Job edited</h2><WorkerEstimateSummary own={{ ...own, madeBeforeEdit: true }} /><TextLink href="/dev/components/worker-estimate?state=edited">Edit</TextLink></section>
        <section className={styles.card} aria-label="Priced (read-only)"><h2>Priced (read-only)</h2><WorkerEstimateSummary own={own} canEdit={false} /></section>
      </div>
      <section className={styles.card} aria-label="Invalid estimate"><h2>Invalid estimate</h2><div className={styles.form}><WorkerEstimateFields value={value} fields={fields} change={change} step={delta => change("hours", String(Math.max(0.5, Math.min(40, Number(value.hours) + delta))))} /></div></section>
    </>}
  </div></section>;
}
