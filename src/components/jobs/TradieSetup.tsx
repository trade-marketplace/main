"use client";
// Tradie home · setup checklist (D01, #132), mockup w-t-onboard. New tradies see it at /jobs until every step is
// done; after that /jobs is the job board, which carries <SetupBanner> for as long as anything is left.
// Every step's state is worked out on the server from saved facts (src/server/workers/setup.ts). This file only
// draws it, and re-reads it when the screen is shown again from the browser's history (Back from a settings page).
import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { TextLink } from "@/components/TextLink";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingRegion } from "@/components/feedback/LoadingRegion";
import { Skeleton } from "@/components/feedback/Skeleton";
import { Banner } from "@/components/overlays/Banner";
import { Pill } from "@/components/status/Pill";
import { BROWSE_JOBS_HREF, SETUP_HOME, setupBannerLabel, setupCount, type SetupStep, type TradieSetup, type TradieSetupResult } from "@/lib/tradie-setup";
import styles from "./tradie-setup.module.css";

/** Server reads already drawn in this tab. Seeing one again means the router restored an old page (Back/Forward). */
const drawn = new Set<string>();

/** Ask the server again when an old copy of the screen comes back, so a step finished elsewhere shows as done. */
function useFreshSetup(checkedAt: string | undefined, live: boolean): boolean {
  const router = useRouter(), [pending, startTransition] = useTransition(), mine = useRef<string | null>(null);
  useEffect(() => {
    if (!live) return;
    const refresh = () => startTransition(() => router.refresh());
    if (checkedAt && mine.current !== checkedAt) {
      if (drawn.has(checkedAt)) refresh();
      drawn.add(checkedAt); mine.current = checkedAt;
    }
    // A page the browser kept whole (bfcache, after leaving for a full page load) is read again from scratch:
    // its router was frozen mid-navigation, so a soft refresh there is not dependable.
    const restored = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener("pageshow", restored); return () => window.removeEventListener("pageshow", restored);
  }, [checkedAt, live, router]);
  return pending;
}

function StepRow({ step }: { step: SetupStep }) {
  const done = step.state === "done";
  return <li className={[styles.step, step.action && "tm-lift"].filter(Boolean).join(" ")} data-state={step.state} data-action={step.action ? "" : undefined}>
    <span className={styles.mark} aria-hidden="true">{done ? <Icon name="check" size="sm" decorative /> : step.state === "checking" ? <Icon name="hourglass_top" size="sm" decorative /> : null}</span>
    <div className={styles.stepText}>
      <span className={styles.stepTitle}>{done ? <>{step.caption !== "Done" && <span className={styles.srOnly}>Done: </span>}<s>{step.title}</s></> : step.title}</span>
      {step.caption && <span className={styles.caption}>{step.caption}</span>}
    </div>
    {(step.state === "checking" || step.problem || step.action) && <div className={styles.stepEnd}>
      {step.state === "checking" && <Pill kind="waiting">Checking</Pill>}
      {step.problem && <Pill kind="alert">{step.problem}</Pill>}
      {step.action && <Button href={step.action.href} size="sm" width="auto">{step.action.label}<span className={styles.srOnly}>({step.title})</span></Button>}
    </div>}
  </li>;
}

export function SetupSkeleton({ rows = 6 }: { rows?: number }) {
  return <div>
    <Skeleton height={8} shape="pill" style={{ marginTop: "var(--trade-space-3)" }} />
    <div className={styles.steps}>{Array.from({ length: rows }, (_, index) => <div key={index} className={styles.skeletonRow}>
      <Skeleton width={32} height={32} shape="circle" /><div><Skeleton width="55%" height={16} /><Skeleton width="35%" height={12} /></div>
    </div>)}</div>
  </div>;
}

export type TradieSetupHomeProps = {
  /** From the signed-in session, so the greeting shows even when the checklist can't be read. */
  firstName: string;
  result: TradieSetupResult;
  /** Dev preview only: hold a state on screen; nothing is re-read from the server. */
  preview?: { loading?: boolean };
};

export function TradieSetupHome({ firstName, result, preview }: TradieSetupHomeProps) {
  const router = useRouter(), setup = result.ok ? result.setup : null;
  const refreshing = useFreshSetup(setup?.checkedAt, !preview), [retrying, startRetry] = useTransition();
  return <div className={styles.page} data-mode="trade">
    <section className={styles.band}><div className={styles.wrap}>
      <h1 className={styles.heading}>Welcome, {firstName}. Let’s get you working.</h1>
      <p className={styles.lead}>Finish these and you can claim jobs.{setup?.licenceChecking && setup.canBrowse ? " You can browse while we check your licence." : ""}</p>
    </div></section>
    <div className={`${styles.wrap} ${styles.content} tm-stagger`}>
      <section className={styles.card} aria-labelledby="setup-heading">
        <div className={styles.cardHead}><h2 id="setup-heading">Get set up</h2>
          {setup && !refreshing && !preview?.loading && <p className={styles.count}><b>{setupCount(setup)}</b> done</p>}</div>
        {!setup ? <ErrorState className={styles.failed} headingLevel={3} announce={false} title="Can’t load your setup" message="Check your connection and try again." retrying={retrying} onRetry={() => startRetry(() => router.refresh())} />
          : <LoadingRegion loading={refreshing || Boolean(preview?.loading)} label="Loading your setup" skeleton={<SetupSkeleton rows={setup.total} />}>
            <div className={styles.track} role="progressbar" aria-labelledby="setup-heading" aria-valuemin={0} aria-valuemax={setup.total} aria-valuenow={setup.done} aria-valuetext={`${setupCount(setup)} done`}>
              <span className={styles.fill} style={{ width: `${(setup.done / setup.total) * 100}%` }} />
            </div>
            <ol className={styles.steps}>{setup.steps.map(step => <StepRow key={step.id} step={step} />)}</ol>
          </LoadingRegion>}
      </section>
      <div className={styles.aside}>
        {setup?.canBrowse && <section className={`${styles.card} ${styles.side}`} aria-labelledby="setup-wait">
          <h2 id="setup-wait">While you wait</h2>
          <p>Browse jobs and send estimates. Estimating helps set fair prices.</p>
          <Button href={BROWSE_JOBS_HREF} size="sm" width="full">Browse jobs</Button>
        </section>}
        <section className={`${styles.card} ${styles.side}`} aria-labelledby="setup-how">
          <h2 id="setup-how">How it works</h2>
          <ol className={styles.how}><li>Estimate jobs (private)</li><li>Claim priced jobs: first in</li><li>Do the work, upload evidence</li><li>Get paid next payroll</li></ol>
        </section>
      </div>
    </div>
  </div>;
}

/** The slim banner on the job board while setup isn't finished. It opens the checklist at plain /jobs. */
export function SetupBanner({ setup, href = SETUP_HOME, live = true }: { setup: Pick<TradieSetup, "done" | "total" | "checkedAt">; href?: string; live?: boolean }) {
  useFreshSetup(setup.checkedAt, live);
  return <Banner tone="brand" icon="checklist" className={styles.banner} action={<TextLink href={href} inline>{setupBannerLabel(setup)}</TextLink>} />;
}
