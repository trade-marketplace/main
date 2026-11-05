"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { OfflineBanner, useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { SkeletonText } from "@/components/feedback/Skeleton";
import { Banner } from "@/components/overlays/Banner";
import { Pill } from "@/components/status/Pill";
import type { OfficeProblemReportState } from "@/lib/office-problem";
import styles from "./problem-report.module.css";

export function ProblemReportCard({ value }: { value: OfficeProblemReportState }) {
  const router = useRouter(), browserOnline = useOnlineStatus();
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const report = "report" in value ? value.report : null, online = browserOnline && value.state !== "offline";
  const retry = () => { setFailed(new Set()); router.refresh(); };
  const photoError = report?.photos.some(photo => !photo.url || failed.has(photo.url));
  return <section id="problem-report" className={styles.card} aria-labelledby="problem-report-title">
    <header className={styles.heading}><h2 id="problem-report-title">Problem report</h2>{report && <Pill kind={report.status === "OPEN" ? "waiting" : "good"}>{report.status === "OPEN" ? "Open" : "Resolved"}</Pill>}</header>
    <OfflineBanner online={value.state === "offline" ? false : undefined} sticky={false} />
    {value.state === "loading" ? <div role="status" aria-label="Loading problem report"><SkeletonText lines={4} /></div> : value.state === "error" ? <>
      <Banner tone="alert" title="Couldn’t load the problem report." />
      <Button variant="secondary" onClick={retry} disabled={!online ? "You’re offline" : false}>Try again</Button>
    </> : report ? <>
      <time className={styles.caption} dateTime={report.createdAt}>{report.when}</time>
      {report.urgent && <Banner tone="alert" title="Urgent / safety" />}
      <dl className={styles.details}><div><dt>Topic</dt><dd>{report.topic}</dd></div><div><dt>Details</dt><dd>{report.details}</dd></div></dl>
      {photoError && <Banner tone="alert" title="Photo unavailable" action={<Button variant="tertiary" onClick={retry} disabled={!online ? "You’re offline" : false}>Try again</Button>} />}
      {report.photos.length ? <div className={styles.photos}>{report.photos.map((photo, index) => photo.url && !failed.has(photo.url)
        // Signed private URLs are renewed by the authorized page read when retrying or reloading.
        // eslint-disable-next-line @next/next/no-img-element
        ? <a href={photo.url} key={photo.id} target="_blank" rel="noreferrer"><img src={photo.url} alt={`Report photo ${index + 1}`} onError={() => setFailed(previous => new Set(previous).add(photo.url!))} /></a>
        : <p className={styles.caption} key={photo.id}>Photo unavailable</p>)}</div> : <p className={styles.caption}>No photos added.</p>}
    </> : null}
  </section>;
}
