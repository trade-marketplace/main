import type { Metadata } from "next";
import { AppShellView } from "@/components/app/AppShellView";
import { TextLink } from "@/components/TextLink";
import { Banner } from "@/components/overlays/Banner";
import { ClaimNumbers, ClaimNextSteps, WorkerClaimLoading, WorkerClaimLoadError } from "@/components/jobs/WorkerClaim";
import { CLAIM_FAILURE_COPY } from "@/lib/worker-claim";
import type { EligibilityFailure } from "@/server/workers/eligibility";
import { guardDevPage } from "@/server/dev-pages";
import { workerClaimView } from "@/server/jobs/worker-claim-reader";
import { exampleJob, VIEWERS } from "@/app/dev/components/job-views/preview-data";
import styles from "@/components/jobs/worker-claim.module.css";
import { ClaimDemo } from "./ClaimDemo";
import { ProblemThreadsDemo } from "@/app/dev/components/problem-threads/ProblemThreadsDemo";
import { boardJobHref } from "@/lib/job-board";
import { SIGNUP_TRADES } from "@/lib/auth/worker-signup";
export const metadata: Metadata = { title: "Claim job (dev)", robots: { index: false, follow: false } };
const STATES = ["ready", "confirm", "success", "lost", "loading", "empty", "photo-error", "error", "offline", "saving", "load-error", "not-eligible", "wrong-trade", "paused", "licence", "eligibility-gallery", "points"];
const FAILURES: Record<string, EligibilityFailure> = { "not-eligible": "identity-required", "wrong-trade": "trade-mismatch", paused: "worker-paused", licence: "licence-required" };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const { state: requested, trade: requestedTrade } = await searchParams, state = STATES.find(value => value === requested) ?? "ready";
  const category = SIGNUP_TRADES.find(trade => trade.value === requestedTrade)?.value ?? "ELECTRICAL";
  const source = exampleJob({ category, status: "BOOKABLE", workerId: null, worker: null, asap: true, description: "Lights in the lounge keep flickering and the switch is getting warm. Pretty sure some wires behind it are exposed." });
  const needs = { cocRequired: true, minPhotos: 0, notesRequired: false };
  const assigned = workerClaimView(VIEWERS.worker, { ...source, status: "ASSIGNED", workerId: VIEWERS.worker.userId }, needs)!;
  const job = state === "success" ? assigned : workerClaimView(VIEWERS.worker, source, needs)!;
  const other = workerClaimView(VIEWERS.worker, { ...source, category: "OTHER" }, { ...needs, cocRequired: false })!;
  return <AppShellView viewer={{ role: "TRADIE", firstName: "Jack", lastName: "Wilson", email: "worker@demo.test", counts: { messages: 0, notifications: 0 }, points: state === "points" ? 3 : 7 }} testMode preview={{ at: `/jobs/${source.id}`, base: `/dev/components/worker-claim?state=${state}` }}>
    {state === "loading" ? <WorkerClaimLoading /> : state === "load-error" ? <WorkerClaimLoadError back="/dev/components/job-board?state=ready&kind=ready" /> : state === "eligibility-gallery" ? <section className={styles.canvas} data-mode="trade"><div className={styles.page}><TextLink href="/dev/components/worker-claim?state=ready">Back to job</TextLink><h2>Claim eligibility</h2><div className={styles.variants}>{Object.entries(FAILURES).map(([name, failure]) => <section className={styles.card} key={name} aria-label={name}><h2>{name === "not-eligible" ? "Not verified" : name === "wrong-trade" ? "Wrong trade" : name === "paused" ? "Account paused" : "Licence expired"}</h2><Banner tone="alert">{CLAIM_FAILURE_COPY[failure]}</Banner></section>)}</div><section className={styles.card} aria-label="Non-electrical claim"><h2>Other job</h2><ClaimNumbers job={other} /><ClaimNextSteps job={other} /></section><ProblemThreadsDemo state="thread" second={false} trade jobReturn={boardJobHref("20000000-0000-4000-8000-000000000001", "/jobs?kind=ready")} /></div></section> : <ClaimDemo job={job} assigned={assigned} state={state} failure={FAILURES[state] ?? null} />}
  </AppShellView>;
}
