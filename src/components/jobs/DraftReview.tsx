"use client";

import Link from "next/link";
import { Button, buttonClasses } from "@/components/Button";
import { Skeleton } from "@/components/feedback/Skeleton";
import { PhotoThumbnail } from "@/components/media/PhotoPicker";
import { Banner } from "@/components/overlays/Banner";
import { DAY_PARTS } from "@/lib/job-time-windows";
import type { PhotoSnapshot } from "@/lib/jobs/draft-photo-manager";
import { JOB_TYPES, whereInputs, type WizardDraft } from "@/lib/post-job-wizard";
import styles from "./post-job.module.css";

export function DraftReview({ draft, photos, editHrefs, backHref, busy, offline, error, onPost, onEdit }: {
  draft: WizardDraft; photos: PhotoSnapshot; editHrefs: readonly string[]; backHref: string;
  busy: boolean; offline: boolean; error: boolean; onPost(): void; onEdit(): void;
}) {
  const where = whereInputs(draft);
  const date = new Intl.DateTimeFormat("en-NZ", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
  const blocked = offline || photos.restoring || photos.saving || photos.storageError || photos.photos.some(photo => photo.status !== "done" || photo.needsRetry || photo.pendingAttach) || photos.photos.length > 6;
  const edit = (href: string) => busy ? <span className={styles.reviewEdit}>Edit</span> : <Link href={href} className={styles.reviewEdit} onClick={onEdit}>Edit</Link>;
  return <div className={styles.review}>
    {error && <Banner tone="alert" title="Couldn’t post." live action={<Button variant="tertiary" onClick={onPost} disabled={busy || blocked}>Try again</Button>} />}
    <section className={styles.reviewSection} aria-label="What needs doing">
      <div className={styles.reviewHeading}><h2>{JOB_TYPES.find(type => type.value === draft.data.category)?.label}</h2>{edit(editHrefs[0])}</div>
      <p className={styles.reviewDescription}>{draft.description}</p>
    </section>
    <section className={styles.reviewSection} aria-label="Photos">
      <div className={styles.reviewHeading}><h2>Photos</h2>{edit(editHrefs[1])}</div>
      {photos.photos.some(photo => photo.status === "uploading") && <p className={styles.hint} role="status">Uploading…</p>}
      {photos.photos.some(photo => photo.status === "failed") && <Banner tone="alert">We couldn&apos;t save that file. Try again.</Banner>}
      {photos.restoring ? <div className={styles.reviewPhotos} role="status" aria-label="Loading photos"><Skeleton height={90} /><Skeleton height={90} /></div> : photos.photos.length ?
        <div className={styles.reviewPhotos}>{photos.photos.map((photo, index) => <div className={styles.reviewPhoto} key={photo.id}><PhotoThumbnail photo={photo} index={index} /></div>)}</div> : <p className={styles.hint}>Photos get you a price faster</p>}
    </section>
    <section className={styles.reviewSection} aria-label="Where and when">
      <div className={styles.reviewHeading}><h2>Where &amp; when</h2>{edit(editHrefs[2])}</div>
      <p>{[where.addressLine2, where.addressLine1, where.suburb, where.city, where.postcode].filter(Boolean).join(", ")}</p>
      {draft.data.asap && <p>As soon as possible</p>}
      {draft.data.anyTime ? <p>Any time</p> : <ul className={styles.reviewWindows}>{draft.data.timeWindows?.map(window => <li key={`${window.date}/${window.timeOfDay}`}>{date.format(new Date(`${window.date}T00:00:00Z`))} · {DAY_PARTS.find(part => part.value === window.timeOfDay)?.label}</li>)}</ul>}
      {where.accessNotes && <p className={styles.reviewDescription}>{where.accessNotes}</p>}
    </section>
    <p className={`${styles.hint} ${styles.reviewTrust}`}>Posting is free. We&apos;ll send you a price.</p>
    <div className={`${styles.actions} ${styles.reviewActions}`}>
      {busy ? <Button variant="tertiary" disabled width="auto">Back</Button> : <Link href={backHref} className={buttonClasses({ variant: "tertiary", width: "auto" })} onClick={onEdit}>Back</Link>}
      <Button variant="hero" onClick={onPost} loading={busy} disabled={blocked} width="full-on-phone">Post it</Button>
    </div>
  </div>;
}
