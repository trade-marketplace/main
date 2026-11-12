import { formatCents } from "@/components/status/PriceBlock";
import type { WorkerExtra } from "@/lib/worker-extras";
import styles from "./extra-work.module.css";

export function ExtraWorkCard({ extra, customerFirstName, label = "Extra work" }: { extra: WorkerExtra; customerFirstName: string; label?: string }) {
  const earn = extra.workerEarnsCents === null ? null : `Earn +${formatCents(extra.workerEarnsCents)}`;
  return <section className={styles.card} aria-label={label}><h2 className={styles.title}>Extra work</h2><p>{extra.description}</p>
    {extra.status === "REQUESTED" && <p role="status">Extra work sent. We’re pricing it.</p>}
    {extra.status === "PRICED" && <><p role="status">Waiting on {customerFirstName}’s OK.</p>{earn && <p><strong>{earn}</strong></p>}</>}
    {extra.status === "APPROVED" && <p role="status">Extra work approved.{earn && <> <strong>{earn}.</strong></>}</p>}
    {extra.status === "DECLINED" && <p role="status">{customerFirstName} said no to the extra work. Finish the original job only.</p>}
  </section>;
}
