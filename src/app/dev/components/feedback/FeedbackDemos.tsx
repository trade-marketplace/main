"use client";
// /dev/components/feedback demos that need a click: loading → content, an upload, retries that fail then work,
// the offline banner, and the usage example (a "My jobs" panel in each state). Nothing is fetched; the waits are
// pretend and the jobs are examples.
import { useState } from "react";

import { Button } from "@/components/Button";
import {
  EmptyState,
  ErrorState,
  type ErrorStateProps,
  InlineError,
  type InlineErrorProps,
  JobRowSkeleton,
  LoadingRegion,
  OfflineBanner,
  ProgressBar,
} from "@/components/feedback";
import { TextLink } from "@/components/TextLink";

import { DEMO_JOBS, USAGE_STATES, type UsageState } from "./demo-data";
import styles from "./feedback.module.css";

const noop = () => {};

/** Static previews for the server page, which can't hand a function to a client component: Try again does nothing. */
export function ErrorPreview(props: Omit<ErrorStateProps, "onRetry">) {
  return <ErrorState {...props} onRetry={noop} />;
}
export function InlineErrorPreview(props: Omit<InlineErrorProps, "onRetry">) {
  return <InlineError {...props} onRetry={noop} />;
}
export function OfflinePreview() {
  return <OfflineBanner online={false} sticky={false} onRetry={noop} />;
}

/**
 * Pretend waits. Not cleared on unmount: React's development double-mount would cancel a wait started by a click
 * that lands while the page hydrates, and a state update after a real unmount does nothing.
 */
function useTimers() {
  return (fn: () => void, ms: number) => {
    setTimeout(fn, ms);
  };
}

const wait = (later: ReturnType<typeof useTimers>, ms: number) => new Promise<void>((done) => later(done, ms));

function JobList() {
  return (
    <ul className={styles.jobs}>
      {DEMO_JOBS.map((job) => (
        <li key={job.id} className={styles.job}>
          <span className={styles.jobPhoto} aria-hidden="true" />
          <span className={styles.jobBody}>
            <span className={styles.jobCat}>{job.cat}</span>
            <span className={styles.jobTitle}>{job.title}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function LoadingDemo() {
  const later = useTimers();
  const [loading, setLoading] = useState(false);
  const [loads, setLoads] = useState(0);
  const load = (ms: number) => {
    setLoading(true);
    later(() => {
      setLoading(false);
      setLoads((n) => n + 1);
    }, ms);
  };
  return (
    <div className={styles.block}>
      <div className={styles.controls}>
        <Button variant="secondary" size="sm" width="auto" disabled={loading ? "Wait for this load to finish" : false} onClick={() => load(200)}>
          Load quickly (0.2s)
        </Button>
        <Button variant="secondary" size="sm" width="auto" disabled={loading ? "Wait for this load to finish" : false} onClick={() => load(3000)}>
          Load slowly (3s)
        </Button>
        <p className={styles.status}>Loaded {loads} {loads === 1 ? "time" : "times"}</p>
      </div>
      <div className={styles.narrow}>
        <LoadingRegion loading={loading} label="Loading your jobs" skeleton={<JobRowSkeleton count={3} />}>
          <JobList />
        </LoadingRegion>
      </div>
    </div>
  );
}

export function UploadDemo() {
  const later = useTimers();
  const [value, setValue] = useState<number | null>(null);
  const start = () => {
    setValue(0);
    for (let step = 1; step <= 10; step += 1) later(() => setValue(step / 10), step * 300);
    later(() => setValue(null), 4000);
  };
  const busy = value !== null;
  return (
    <div className={`${styles.block} ${styles.narrow}`}>
      <Button variant="secondary" size="sm" width="auto" icon="add_a_photo" loading={busy} onClick={start}>
        Upload a photo
      </Button>
      {busy && <ProgressBar label={value === 1 ? "Uploaded kitchen.jpg" : "Uploading kitchen.jpg"} value={value} />}
    </div>
  );
}

export function RetryDemo() {
  const later = useTimers();
  const [tries, setTries] = useState(0);
  const loaded = tries >= 2;
  // The first Try again fails (the error stays), the second works.
  const retry = async () => {
    await wait(later, 1500);
    setTries((n) => n + 1);
  };
  return (
    <div className={`${styles.card} ${styles.narrow}`}>
      {loaded ? (
        <>
          <JobList />
          <p className={styles.status}>Loaded after {tries} tries.</p>
        </>
      ) : (
        <ErrorState
          title="Can’t load your jobs"
          message="Check your connection and try again. If it keeps happening, let us know."
          onRetry={retry}
          secondaryAction={<TextLink href="/dev/components/feedback#errors">Contact support</TextLink>}
          headingLevel={4}
          announce={tries > 0}
        />
      )}
      {!loaded && <p className={styles.status}>Tried {tries} {tries === 1 ? "time" : "times"}. The first try fails, the second works.</p>}
    </div>
  );
}

export function InlineRetryDemo() {
  const later = useTimers();
  const [saved, setSaved] = useState(false);
  return saved ? (
    <p className={styles.para} role="status">
      Saved.
    </p>
  ) : (
    <InlineError
      message="Couldn’t save your changes. Check your connection and try again."
      onRetry={async () => {
        await wait(later, 1200);
        setSaved(true);
      }}
      announce={false}
    />
  );
}

export function OfflineDemo() {
  const [online, setOnline] = useState(true);
  const [retries, setRetries] = useState(0);
  return (
    <div className={styles.block}>
      <div className={styles.controls}>
        <Button variant="secondary" size="sm" width="auto" onClick={() => setOnline((o) => !o)}>
          {online ? "Pretend to go offline" : "Come back online"}
        </Button>
        <p className={styles.status}>Retried {retries} {retries === 1 ? "time" : "times"}</p>
      </div>
      <div className={styles.frame}>
        <OfflineBanner online={online} sticky={false} onRetry={() => setRetries((n) => n + 1)} />
        <div className={styles.frameBody}>
          <JobRowSkeleton count={2} />
        </div>
      </div>
    </div>
  );
}

/**
 * The real banner at the top of this page: it follows the browser (try DevTools › Network › Offline). A retry
 * fetches again; it never reloads or navigates (router.refresh() offline falls back to a full page load, which
 * would lose what someone typed). This page has no data, so it just checks the server answers.
 */
export function PageOfflineBanner() {
  return <OfflineBanner onRetry={() => fetch(window.location.href, { method: "HEAD", cache: "no-store" }).catch(() => {})} />;
}

const USAGE_NAMES: Record<UsageState, string> = { loading: "Loading", empty: "Empty", error: "Error", jobs: "Jobs" };

export function UsageExample({ initial }: { initial: UsageState }) {
  const later = useTimers();
  const [state, setState] = useState<UsageState>(initial);
  return (
    <div className={styles.block}>
      <div className={styles.seg} role="group" aria-label="Show the panel as">
        {USAGE_STATES.map((s) => (
          <Button key={s} variant={s === state ? "primary" : "secondary"} size="sm" width="auto" aria-pressed={s === state} onClick={() => setState(s)}>
            {USAGE_NAMES[s]}
          </Button>
        ))}
      </div>
      <section className={`${styles.card} ${styles.narrow}`} aria-labelledby="usage-panel-title">
        <h3 id="usage-panel-title" className={styles.rowName}>
          My jobs
        </h3>
        <LoadingRegion loading={state === "loading"} label="Loading your jobs" skeleton={<JobRowSkeleton count={3} />}>
          {state === "empty" && (
            <EmptyState
              illustration="van"
              title="Nothing on yet."
              message="Got something that needs doing? Post it free and we’ll get you a price."
              action={<Button href="/dev/components/feedback#usage">Post a job</Button>}
              headingLevel={4}
            />
          )}
          {state === "error" && (
            <ErrorState
              title="Can’t load your jobs"
              message="Check your connection and try again. If it keeps happening, let us know."
              onRetry={async () => {
                await wait(later, 1000);
                setState("jobs");
              }}
              headingLevel={4}
            />
          )}
          {state === "jobs" && <JobList />}
        </LoadingRegion>
      </section>
    </div>
  );
}
