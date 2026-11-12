"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { TextLink } from "@/components/TextLink";
import { ErrorState } from "@/components/feedback/ErrorState";
import { OfflineBanner, useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { Skeleton, SkeletonText } from "@/components/feedback/Skeleton";
import { PhotoGallery } from "@/components/media/PhotoGallery";
import type { ViewerPhoto } from "@/components/media/PhotoViewer";
import { Banner } from "@/components/overlays/Banner";
import { PriceBlock } from "@/components/status/PriceBlock";
import { StatusPill } from "@/components/status/StatusPill";
import { Tracker } from "@/components/status/Tracker";
import { CUSTOMER_JOB_PANELS, CUSTOMER_JOB_POLL_MS, customerJobHref, customerJobReturn, customerJobShouldRefresh } from "@/lib/customer-job";
import { jobTracker } from "@/lib/job-tracker";
import { customerPriceDelayed } from "@/lib/customer-job-waiting";
import type { CustomerJobView } from "@/server/views";
import type { CustomerSignoff } from "@/lib/customer-signoff";
import { SignoffPanel, type SignoffAction } from "./customer/SignoffPanel";
import { CustomerWaitingActions, type WaitingActions } from "./CustomerWaitingActions";
import { PriceReadyPanel, type PriceReadyActions } from "./customer/PriceReadyPanel";
import { ConfirmedPanel } from "./customer/ConfirmedPanel";
import type { CustomerWorkerCard } from "@/lib/customer-worker-card";
import styles from "./customer-job.module.css";

import { CancelJobDialog, type CancelAction } from "./customer/CancelJobDialog";
import { canCancelJob, cancelRevision, CANCEL_REQUESTED_MESSAGE, type CancelFacts } from "@/lib/customer-cancel";

type Props = { cancelFacts?: CancelFacts | null; cancelPreview?: string; cancelAction?: CancelAction; job: CustomerJobView; photos?: readonly ViewerPhoto[]; photosFailed?: boolean; photoLease?: { batchId: string; renewAfterMs: number } | null; back?: string; canEditWindows?: boolean; preview?: "offline" | "static"; initialAgeMs?: number; waitingPreview?: string; waitingActions?: WaitingActions; problemHref?: string; workerCard?: CustomerWorkerCard | null; confirmedWindowsHref?: string; signoffData?: CustomerSignoff | null; signoffPreview?: string; signoffAction?: SignoffAction; previousPriceCents?: number | null; pricePreview?: string; priceActions?: PriceReadyActions };
const trades = { ELECTRICAL: "Electrical", PLUMBING: "Plumbing", GAS: "Gas", CONSTRUCTION: "Construction", OTHER: "Other" } as const;
const date = new Intl.DateTimeFormat("en-NZ", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const postedDate = new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", weekday: "short", day: "numeric", month: "short" });
const time = { MORNING: "Morning", AFTERNOON: "Afternoon", EVENING: "Evening" } as const;

export function CustomerJob({ job, photos = [], photosFailed = false, photoLease, back = "/", canEditWindows = false, preview, initialAgeMs = 0, waitingPreview, waitingActions, problemHref, workerCard, confirmedWindowsHref, signoffData, signoffPreview, signoffAction, previousPriceCents = null, pricePreview, priceActions, cancelFacts, cancelPreview, cancelAction }: Props) {
  const router = useRouter();
  const browserOnline = useOnlineStatus();
  const online = browserOnline && preview !== "offline";
  const [refreshing, startRefresh] = useTransition();
  const [failedGallery, setFailedGallery] = useState<string | null>(null);
  const [ageMs, setAgeMs] = useState(initialAgeMs);
  const renewAt = useRef<number | null>(null);
  const [cancelFocusJob, setCancelFocusJob] = useState<string | null>(null);
  const statusHeading = useRef<HTMLHeadingElement>(null);
  const photoBatch = photoLease?.batchId, photoRenewAfterMs = photoLease?.renewAfterMs;
  const photoKey = photos.map(photo => photo.src).join("\n");
  const photoError = photosFailed || failedGallery === photoKey;
  const panel = CUSTOMER_JOB_PANELS[job.status];
  const titleId = `customer-job-${job.id}`;
  const statusId = `${titleId}-status`;
  const tracker = jobTracker(job.status, "customer", { tradieName: job.worker?.firstName });
  const returnTo = customerJobReturn(back);
  const refresh = () => { if (online) startRefresh(() => router.refresh()); };
  const retryPhotos = () => { setFailedGallery(null); refresh(); };

  useEffect(() => {
    if ((job.status !== "CANCELLED" && job.status !== "CANCEL_REVIEW") || cancelFocusJob !== job.id) return;
    let frame = 0;
    const moveFocus = () => {
      if (document.querySelector("dialog[open]")) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (document.querySelector("dialog[open]")) return;
        statusHeading.current?.focus({ preventScroll: true });
        statusHeading.current?.scrollIntoView({ block: "nearest" });
        setCancelFocusJob(null);
        observer.disconnect();
      });
    };
    const observer = new MutationObserver(moveFocus);
    observer.observe(document.body, { childList: true, subtree: true });
    moveFocus();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [job.status, job.id, cancelFocusJob]);

  useEffect(() => {
    if (preview || job.status !== "REVIEW") return;
    const started = Date.now();
    const timer = setInterval(() => setAgeMs(initialAgeMs + Date.now() - started), 60_000);
    return () => clearInterval(timer);
  }, [initialAgeMs, job.status, preview]);

  // Anchor the server-provided remaining lifetime to this browser's clock, once per signed response.
  useEffect(() => { renewAt.current = photoRenewAfterMs === undefined ? null : Date.now() + photoRenewAfterMs; }, [photoBatch, photoRenewAfterMs]);

  useEffect(() => {
    if (preview) return;
    const abort = new AbortController();
    let checking = false, refreshRequested = false;
    const canUpdate = () => !abort.signal.aborted && !refreshing && !refreshRequested && navigator.onLine && document.visibilityState === "visible" && !document.querySelector("dialog[open]");
    const refreshFrame = () => { refreshRequested = true; startRefresh(() => router.refresh()); };
    async function update() {
      if (!canUpdate() || checking) return;
      if (renewAt.current !== null && Date.now() >= renewAt.current) { refreshFrame(); return; }
      if (!customerJobShouldRefresh(job.status, true, "visible")) return;
      checking = true;
      try {
        const response = await fetch(`/api/jobs/${job.id}/revision`, { cache: "no-store", credentials: "same-origin", signal: abort.signal });
        if (!canUpdate()) return;
        if ([401, 403, 404].includes(response.status)) { refreshFrame(); return; }
        if (!response.ok) return;
        const latest: unknown = await response.json();
        if (canUpdate() && latest && typeof latest === "object" && "revision" in latest && typeof latest.revision === "string" && "status" in latest && typeof latest.status === "string" && (latest.revision !== job.updatedAt || latest.status !== job.status)) refreshFrame();
      } catch { /* A failed check leaves the current frame intact; the next interval or explicit retry can recover. */ }
      finally { checking = false; }
    }
    const timer = setInterval(update, CUSTOMER_JOB_POLL_MS);
    const remaining = renewAt.current === null ? null : renewAt.current - Date.now();
    const renewal = remaining === null ? undefined : setTimeout(update, remaining > 0 ? remaining : CUSTOMER_JOB_POLL_MS);
    window.addEventListener("online", update);
    document.addEventListener("visibilitychange", update);
    return () => { abort.abort(); clearInterval(timer); clearTimeout(renewal); window.removeEventListener("online", update); document.removeEventListener("visibilitychange", update); };
  }, [job.id, job.status, job.updatedAt, photoBatch, photoRenewAfterMs, preview, refreshing, router]);

  const windows = job.bookedDate && job.bookedTime ? [{ date: job.bookedDate, timeOfDay: job.bookedTime }] : job.timeWindows;
  return <section className={styles.page} data-mode="customer" aria-labelledby={`${titleId} ${statusId}`}>
    <div className={styles.wrap}>
      <nav className={styles.breadcrumb} aria-label={`Back · ${job.title} · ${panel.heading}`}><TextLink href={returnTo}>{returnTo === "/" ? "Home" : "My jobs"}</TextLink><Icon name="chevron_right" decorative size="sm" /><span>{job.title}</span></nav>
      <OfflineBanner online={preview === "offline" ? false : undefined} sticky={false} onRetry={refresh} className={styles.notice} />
      <div className={`${styles.grid} ${styles.loaded}`}>
        <div className={styles.details}>
          {photoError ? <Banner tone="alert" title="Can’t load photos." className={styles.notice} action={<Button variant="tertiary" disabled={!online ? "You’re offline" : false} loading={refreshing} onClick={retryPhotos}>Try again</Button>} /> : photos.length ? <div className={styles.galleryWrap} onErrorCapture={event => { if (event.target instanceof HTMLImageElement) setFailedGallery(photoKey); }}><PhotoGallery photos={photos} label={`Photos of ${job.title}`} className={styles.gallery} /></div> : <div className={styles.emptyPhotos}><Icon name="photo_library" decorative /><p>No photos yet.</p></div>}
          <div className={styles.detailCard}>
            <div className={styles.meta}><span className={styles.trade}>{trades[job.category]}</span><span>TM-{job.jobNumber} · posted {postedDate.format(new Date(job.createdAt))}</span></div>
            <h1 id={titleId} className={styles.title}>{job.title}</h1>
            <p className={styles.description}>{job.description}</p>
          </div>
          <dl className={styles.info}>
              <div><dt>Where</dt><dd>{[job.address.line2, job.address.line1, job.suburb, job.city, job.address.postcode].filter(Boolean).join(", ")}</dd></div>
              <div><dt>When</dt><dd>{job.asap && <p>ASAP</p>}{!job.bookedDate && job.anyTime ? <p>Any time</p> : windows.length ? <ul>{windows.map(window => <li key={`${window.date}/${window.timeOfDay}`}>{date.format(new Date(`${window.date}T00:00:00Z`))} · {time[window.timeOfDay]}</li>)}</ul> : <p>Time to be arranged</p>}{canEditWindows && <TextLink href={`/jobs/${job.id}/windows?from=${encodeURIComponent(customerJobHref(job.id, returnTo))}`}>Time windows</TextLink>}</dd></div>
              <div><dt>Access</dt><dd className={styles.description}>{job.address.accessNotes || "—"}</dd></div>
          </dl>
        </div>
        <aside className={styles.sidebar} aria-label={`Job status · ${job.title} · ${panel.heading}`}>
          <div className={`${styles.card} ${styles.statusCard}`} data-panel={panel.kind}>
            <span id={statusId} className={styles.status}><StatusPill status={job.status} audience="customer" announce /></span>
            <div className={styles.panelContent}>
              <h2 ref={statusHeading} tabIndex={-1} className={styles.heading}>{panel.heading}</h2>
              {panel.message && <p className={styles.message}>{panel.message}</p>}
              {(job.status === "REVIEW" || job.status === "QUOTE_BOUNTY") && <>
                {job.status === "REVIEW" && customerPriceDelayed(ageMs) && <Banner tone="info" title="Taking a little longer than usual" className={styles.notice}>Still working on it. Thanks for your patience. We’ll message you.</Banner>}
                <CustomerWaitingActions key={job.id} job={job} online={online} preview={waitingPreview} actions={waitingActions} cancelFacts={cancelFacts} cancelAction={cancelAction} onCancelled={() => setCancelFocusJob(job.id)} />
              </>}
              {canCancelJob(job.status) && cancelFacts === null && <Banner tone="alert" title="Couldn’t load cancellation options." action={<Button variant="tertiary" disabled={!online} loading={refreshing} onClick={refresh}>Try again</Button>} />}
              {job.status === "CANCEL_REVIEW" && <Banner tone="info" title={CANCEL_REQUESTED_MESSAGE} live className={styles.notice} />}
              {(job.status === "BOOKABLE" || job.status === "ASSIGNED") && cancelFacts?.canCancel && <CancelJobDialog jobId={job.id} revision={cancelRevision(job.updatedAt, job.status)} facts={cancelFacts} online={online} preview={cancelPreview} action={cancelAction} onCancelled={() => setCancelFocusJob(job.id)} />}
              {job.status === "PRICED" && <PriceReadyPanel key={job.id} job={job} previousPriceCents={previousPriceCents} online={online} preview={pricePreview} actions={priceActions} onDeclined={() => setCancelFocusJob(job.id)} />}
              {panel.kind === "confirmed" && job.worker && <ConfirmedPanel job={job} card={workerCard} back={returnTo} online={online} preview={Boolean(preview)} windowsHref={confirmedWindowsHref} />}
              {job.status === "SUBMITTED" ? <SignoffPanel key={`${job.id}:${job.worker?.id ?? ""}:${signoffData?.evidenceRevision ?? ""}`} job={job} data={signoffData ?? null} online={online} problemHref={problemHref ?? `/jobs/${job.id}/problem?from=${encodeURIComponent(customerJobHref(job.id, returnTo))}`} preview={signoffPreview} action={signoffAction} /> : panel.price && job.status !== "PRICED" && job.priceCents !== null && <PriceBlock audience="customer" priceCents={job.priceCents} />}
              {job.status === "COMPLETED" && signoffData?.autoCompleted && <p className={styles.message}>We marked this done automatically.</p>}
            </div>
            {tracker && <div className={styles.tracker}><Tracker {...tracker} /></div>}
          </div>
          <div className={`${styles.card} ${styles.help}`}><TextLink href={problemHref ?? `/jobs/${job.id}/problem?from=${encodeURIComponent(customerJobHref(job.id, returnTo))}`}>Report a problem</TextLink><TextLink href="/help">Need a hand?</TextLink></div>
        </aside>
      </div>
    </div>
  </section>;
}

export function CustomerJobLoading() {
  return <section className={styles.page} data-mode="customer" aria-label="Loading job" aria-busy="true"><div className={styles.wrap}>
    <h1 className={styles.srOnly}>Your job</h1><div role="status" aria-label="Loading job" className={styles.grid}>
      <div className={styles.details}><Skeleton height="22rem" /><div className={styles.detailCard}><Skeleton width="40%" /><Skeleton width="70%" height="2.5rem" /><SkeletonText lines={3} /></div></div>
      <div className={styles.card}><Skeleton width="45%" height="1.5rem" /><Skeleton height="2rem" /><SkeletonText lines={2} /><Skeleton height="14rem" /></div>
    </div>
  </div></section>;
}

export function CustomerJobLoadError() {
  const router = useRouter();
  return <section className={styles.page} data-mode="customer"><div className={styles.wrap}><div className={styles.card}>
    <ErrorState title="Couldn’t load the job." headingLevel={1} onRetry={() => router.refresh()} secondaryAction={<TextLink href="/">Home</TextLink>} />
  </div></div></section>;
}
