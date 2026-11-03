import type { Metadata } from "next";
import Link from "next/link";
import { guardDevPage } from "@/server/dev-pages";
import { customerJobView, officeJobView, publicJobView, workerJobView } from "@/server/views/jobs";
import { JOB_VIEW_PREVIEW_STATES as STATES, jobViewExample, type JobViewPreviewState as State, VIEWERS } from "./preview-data";
import { NotFoundView } from "@/components/errors/NotFoundView";
import styles from "./preview.module.css";

export const metadata: Metadata = { title: "Job data views (dev)", robots: { index: false, follow: false } };
const money = (cents: number | null) => cents === null ? "—" : new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(cents / 100);

export default async function JobViewsPreview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams;
  const state: State = STATES.includes(params.state as State) ? params.state as State : "worker-unclaimed";
  const job = jobViewExample(state);
  const office = state === "office" ? officeJobView(VIEWERS.office, job) : null;
  const view = state === "customer" ? customerJobView(VIEWERS.customer, job) : office ?? (state === "public" ? publicJobView() : workerJobView(VIEWERS.worker, job));
  const mode = state === "customer" ? "customer" : state === "office" ? "office" : "trade";
  const customer = state === "customer" ? customerJobView(VIEWERS.customer, job) : null;
  const worker = mode === "trade" && state !== "public" ? workerJobView(VIEWERS.worker, job) : null;
  if (state === "worker-reassigned" && !view) return <main className={styles.page} data-mode={mode}><NotFoundView /></main>;
  return <main className={styles.page} data-mode={mode}>
    <header><p className={styles.eyebrow}>Dev only · example data</p><h1>Who sees what</h1></header>
    <nav className={styles.states} aria-label="Preview state">{STATES.map(value => <Link key={value} href={`?state=${value}`} aria-current={state === value ? "page" : undefined}>{value.replaceAll("-", " ")}</Link>)}</nav>
    {state === "loading" ? <section className={styles.card} aria-label="Loading job" aria-busy="true"><div className={styles.skeleton} /><div className={styles.skeleton} /><div className={styles.skeleton} /></section> : state === "error" ? <section className={styles.card}><h2>Can’t load this job</h2><p>Try again in a moment.</p><Link className={styles.action} href="?state=worker-assigned">Try again</Link></section> : !view ? <section className={styles.card}><h2>Nothing to show</h2><p>Public visitors receive no private job data.</p></section> : <>
      <section className={styles.card} aria-labelledby="job-title"><p className={styles.eyebrow}>TM-{view.jobNumber} · {view.status}</p><h2 id="job-title">{view.title}</h2><p>{view.description}</p>
        <dl className={styles.fields}>
          <div><dt>Location</dt><dd>{view.suburb}, {view.city}</dd></div>
          <div><dt>Address</dt><dd>{view.address?.line1 ?? "Hidden until claimed"}</dd></div>
          <div><dt>Phone</dt><dd>{worker?.customer?.phone ?? customer?.worker?.phone ?? office?.customer?.phone ?? "Hidden until claimed"}</dd></div>
          <div><dt>Pin</dt><dd>{view.point ? `${view.point.lat.toFixed(5)}, ${view.point.lng.toFixed(5)}` : "No pin available"}{worker?.point ? ` · ${worker.precision}` : ""}</dd></div>
          {customer && <div><dt>Total incl GST</dt><dd>{money(customer.priceCents)}</dd></div>}
          {worker && <div><dt>Earn</dt><dd>{money(worker.earnCents)}</dd></div>}
        </dl>
      </section>
      <details className={styles.card}><summary>View serialized data</summary><pre>{JSON.stringify(view, null, 2)}</pre></details>
    </>}
  </main>;
}
