import Link from "next/link";
import { Pill } from "@/components/status/Pill";
import { formatCents } from "@/lib/earnings";
import { boardJobHref } from "@/lib/job-board";
import { myWorkHref, myWorkPill, myWorkSecondLine, type MyWorkJob, type MyWorkQuery } from "@/lib/my-work";
import styles from "./my-work.module.css";

export function MyWorkCard({ job, query, autoReleaseHours, now }: { job: MyWorkJob; query: MyWorkQuery; autoReleaseHours: number; now?: Date }) {
  const pill = myWorkPill(job, autoReleaseHours, now);
  return <Link href={boardJobHref(job.id, myWorkHref(query))} className={`${styles.card} tm-lift`}>
    <h3>{job.title}</h3><p className={styles.meta}>{myWorkSecondLine(job, now)}</p>
    <div className={styles.cardFoot}><Pill kind={pill.kind}>{pill.label}</Pill><span className={styles.earn}>
      <span>Earn</span><strong aria-label={job.earnCents === null ? "Earn amount unavailable" : undefined}>{job.earnCents === null ? "—" : formatCents(job.earnCents)}</strong>
    </span></div>
  </Link>;
}
