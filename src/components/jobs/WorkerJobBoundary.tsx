import { TextLink } from "@/components/TextLink";
import type { WorkerJobView } from "@/server/views";
import styles from "./board.module.css";

/** Worker summary boundary for #138; claim/estimate details belong to #144/#145. */
export function WorkerJobBoundary({ job, back }: { job: Pick<WorkerJobView, "title" | "suburb" | "city">; back: string }) {
  return <section className={styles.detail} data-mode="trade"><div className={styles.boundary}>
    <TextLink href={back}>Back to jobs</TextLink><h1>{job.title}</h1><p>{job.suburb} · {job.city}</p>
  </div></section>;
}
