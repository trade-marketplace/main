"use client";

import { useEffect, useState, useTransition } from "react";
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
import type { CustomerJobView } from "@/server/views";
import styles from "./customer-job.module.css";

type Props = { job: CustomerJobView; photos?: readonly ViewerPhoto[]; photosFailed?: boolean; back?: string; preview?: "offline" | "static" };
const trades = { ELECTRICAL: "Electrical", PLUMBING: "Plumbing", GAS: "Gas", CONSTRUCTION: "Construction", OTHER: "Other" } as const;
const date = new Intl.DateTimeFormat("en-NZ", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const postedDate = new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", weekday: "short", day: "numeric", month: "short" });
const time = { MORNING: "Morning", AFTERNOON: "Afternoon", EVENING: "Evening" } as const;

export function CustomerJob({ job, photos = [], photosFailed = false, back = "/", preview }: Props) {
  const router = useRouter();
  const browserOnline = useOnlineStatus();
  const online = browserOnline && preview !== "offline";
  const [refreshing, startRefresh] = useTransition();
  const [failedGallery, setFailedGallery] = useState<string | null>(null);
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
    if (preview) return;
    function update() {
      if (!refreshing && !document.querySelector("dialog[open]") && customerJobShouldRefresh(job.status, navigator.onLine, document.visibilityState)) startRefresh(() => router.refresh());
    }
    const timer = setInterval(update, CUSTOMER_JOB_POLL_MS);
    window.addEventListener("online", update);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); window.removeEventListener("online", update); document.removeEventListener("visibilitychange", update); };
  }, [job.status, preview, refreshing, router]);

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
              <div><dt>When</dt><dd>{job.asap && <p>ASAP</p>}{!job.bookedDate && job.anyTime ? <p>Any time</p> : windows.length ? <ul>{windows.map(window => <li key={`${window.date}/${window.timeOfDay}`}>{date.format(new Date(`${window.date}T00:00:00Z`))} · {time[window.timeOfDay]}</li>)}</ul> : <p>Time to be arranged</p>}{panel.windows && <TextLink href={`/jobs/${job.id}/windows?from=${encodeURIComponent(customerJobHref(job.id, returnTo))}`}>Time windows</TextLink>}</dd></div>
              <div><dt>Access</dt><dd className={styles.description}>{job.address.accessNotes || "—"}</dd></div>
          </dl>
        </div>
        <aside className={styles.sidebar} aria-label={`Job status · ${job.title} · ${panel.heading}`}>
          <div className={`${styles.card} ${styles.statusCard}`} data-panel={panel.kind}>
            <span id={statusId} className={styles.status}><StatusPill status={job.status} audience="customer" announce /></span>
            <div className={styles.panelContent}>
              <h2 className={styles.heading}>{panel.heading}</h2>
              {panel.message && <p className={styles.message}>{panel.message}</p>}
              {panel.kind === "confirmed" && job.worker && <p className={styles.worker}>{job.worker.firstName}{job.worker.lastInitial ? ` ${job.worker.lastInitial}` : ""}</p>}
              {panel.price && job.priceCents !== null && <PriceBlock audience="customer" priceCents={job.priceCents} />}
            </div>
            {tracker && <div className={styles.tracker}><Tracker {...tracker} /></div>}
          </div>
          <div className={`${styles.card} ${styles.help}`}><TextLink href="/help">Need a hand?</TextLink></div>
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
