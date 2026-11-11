"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { TextLink } from "@/components/TextLink";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { ChipGroup } from "@/components/forms/ChoiceFields";
import { TextAreaField } from "@/components/forms/TextFields";
import { PhotoGallery } from "@/components/media/PhotoGallery";
import { StarInput } from "@/components/media/Stars";
import { BoltFlash } from "@/components/motion/BoltFlash";
import { Banner } from "@/components/overlays/Banner";
import { SIGNOFF_REVIEW_TAGS, type CustomerSignoff, type SignoffReview } from "@/lib/customer-signoff";
import { usePrefersReducedMotion } from "@/lib/motion/hooks";
import { signOffJobAction } from "@/server/jobs/customer-signoff-actions";
import type { CustomerJobView } from "@/server/views";
import styles from "./signoff.module.css";

export type SignoffAction = typeof signOffJobAction;
const tags = SIGNOFF_REVIEW_TAGS.map(value => ({ value, label: value }));
export function SignoffPanel({ job, data, online, problemHref, preview, action = signOffJobAction }: {
  job: CustomerJobView; data: CustomerSignoff | null; online: boolean; problemHref: string; preview?: string; action?: SignoffAction;
}) {
  const router = useRouter(), session = useOptionalSessionExpired(), reduced = usePrefersReducedMotion(), id = useId();
  const [rating, setRating] = useState<number | null>(preview === "rated" ? 4 : null), [selectedTags, setTags] = useState<string[]>(preview === "rated" ? ["On time", "Tidy"] : []), [comment, setComment] = useState("");
  const [revision, setRevision] = useState(job.updatedAt), [busy, setBusy] = useState(false), [failed, setFailed] = useState(preview === "error"), [changed, setChanged] = useState(false), [sorted, setSorted] = useState(preview === "sorted");
  const [clock, setClock] = useState<number | null>(null), [brokenFiles, setBrokenFiles] = useState<string | null>(null), [checkingFiles, setCheckingFiles] = useState(false);
  const pending = useRef(false), finished = useRef<ReturnType<typeof setTimeout> | null>(null), files = useRef<HTMLDivElement>(null), form = useRef<HTMLFormElement>(null);
  const fileKey = [data?.cocUrl, ...(data?.photos.map(photo => photo.url) ?? [])].join("|");
  const saving = busy || preview === "saving";
  const failedFiles = Boolean(data?.filesUnavailable) || brokenFiles !== null || checkingFiles;
  useEffect(() => () => { if (finished.current) clearTimeout(finished.current); }, []);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const images = [...files.current?.querySelectorAll("img") ?? []];
      if (images.some(image => image.complete && image.naturalWidth === 0)) setBrokenFiles(fileKey);
      else if (images.length && images.every(image => image.complete && image.naturalWidth > 0)) { setBrokenFiles(null); setCheckingFiles(false); }
    });
    return () => cancelAnimationFrame(frame);
  }, [fileKey]);
  useEffect(() => {
    if (preview || !online || !data) return;
    const renew = () => { if (navigator.onLine && document.visibilityState === "visible" && !document.querySelector("dialog[open]")) router.refresh(); };
    const timer = setInterval(renew, data.filesRenewAfterMs);
    window.addEventListener("online", renew); document.addEventListener("visibilitychange", renew);
    return () => { clearInterval(timer); window.removeEventListener("online", renew); document.removeEventListener("visibilitychange", renew); };
  }, [data, online, preview, router]);
  function retry() { setRevision(job.updatedAt); setChanged(false); if (brokenFiles === fileKey) setCheckingFiles(true); setBrokenFiles(null); router.refresh(); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || saving || !online || !data?.submittedAt || failedFiles || changed || sorted) return;
    pending.current = true; setBusy(true); setFailed(false);
    const review: SignoffReview | undefined = rating === null ? undefined : { rating, tags: selectedTags as SignoffReview["tags"], comment };
    try {
      const result = await action(job.id, { jobUpdatedAt: revision, workerId: job.worker?.id ?? null, evidenceRevision: data.evidenceRevision }, review);
      if (session?.check(result)) return;
      if (!("status" in result)) { setFailed(true); return; }
      if (result.status === "signed-off") {
        setSorted(true);
        finished.current = setTimeout(() => router.refresh(), reduced ? 0 : 600);
      } else if (result.status === "changed" || result.status === "forbidden") { setChanged(true); router.refresh(); }
      else setFailed(true);
    } catch { setFailed(true); }
    finally { pending.current = false; setBusy(false); }
  }
  const retryButton = <Button variant="tertiary" disabled={!online ? "You’re offline" : false} onClick={retry}>Try again</Button>;
  if (!data) return <Banner tone="alert" title="Can’t load the files." action={retryButton} />;
  if (sorted) return <div className={styles.sorted} role="status"><BoltFlash eventId={`sorted:${job.id}`} mark="check" size={92} /><p>Sorted.</p></div>;
  const hoursLeft = clock !== null && data.releaseAt ? Math.max(0, (new Date(data.releaseAt).getTime() - clock) / 3_600_000) : data.hoursLeft;
  const photos = data.photos.flatMap((photo, index) => photo.url ? [{ src: photo.url, alt: `Finished work · ${index + 1}` }] : []);
  return <div className={styles.panel}>
    <p className={styles.intro}>{job.worker?.firstName ?? "Your tradie"}’s finished. All good?</p>
    <section aria-label={`Finished work · ${job.title}`} className={styles.evidence}>
      <h3 id={`${id}-evidence`}>Finished work</h3>
      {data.cocNumber && <div className={styles.certificate}><Icon name="description" fill decorative /><div><strong>Certificate of Compliance</strong><p>CoC {data.cocNumber} · {data.cocFileLabel}</p></div>{data.cocUrl && <TextLink href={data.cocUrl} target="_blank" rel="noopener noreferrer">View<span className={styles.srOnly}> Certificate of Compliance (opens in a new tab)</span></TextLink>}</div>}
      {failedFiles && <Banner tone="alert" title="Can’t load the files." action={retryButton} />}
      {photos.length > 0 && brokenFiles !== fileKey && <div ref={files} onErrorCapture={event => { if (event.target instanceof HTMLImageElement) setBrokenFiles(fileKey); }} onLoadCapture={() => { if ([...files.current?.querySelectorAll("img") ?? []].every(image => image.complete && image.naturalWidth > 0)) { setBrokenFiles(null); setCheckingFiles(false); } }}><PhotoGallery photos={photos} label={`Finished work · ${job.title}`} className={styles.photos} /></div>}
      {!data.cocNumber && !data.photos.length && <p className={styles.quiet}>No finished-work files yet.</p>}
      {data.notes && <p className={styles.notes}>{data.notes}</p>}
    </section>
    <form ref={form} onSubmit={submit} className={styles.form} aria-label={`Sign off ${job.title}`}>
      <fieldset disabled={saving || !online || changed} className={styles.review}>
        <StarInput name={`rating-${id}`} value={rating} onChange={setRating} label={`Rate ${job.worker?.firstName ?? "your tradie"}`} className={styles.stars} />
        <ChipGroup label="Review tags" hideLabel multiple value={selectedTags} onChange={setTags} options={tags} disabled={rating === null} className={styles.tags} />
        {rating !== null && <TextAreaField label="Add a comment (optional)" value={comment} onChange={event => setComment(event.target.value)} maxLength={1000} rows={3} />}
      </fieldset>
      {failed && <Banner tone="alert" title="Couldn’t save. Try again." live action={<Button variant="tertiary" disabled={!online} onClick={() => form.current?.requestSubmit()}>Try again</Button>} />}
      {changed && <Banner tone="info" title="Job updated. Check it again." live action={retryButton} />}
      <div className={styles.actions}>
        <Button type="submit" loading={saving} disabled={!online ? "You’re offline" : changed ? "Check the updated job first" : !data.submittedAt ? "Finished work isn’t available yet" : failedFiles}>Yes, all sorted</Button>
        {saving ? <Button variant="secondary" disabled>Something’s not right</Button> : <Button href={problemHref} variant="secondary">Something’s not right</Button>}
      </div>
    </form>
    {data.problemOpen ? <p className={styles.countdown}>Auto-release is paused while your report is open.</p> : <div className={styles.countdown}><p>No reply in {data.autoReleaseHours} {data.autoReleaseHours === 1 ? "hour" : "hours"} and we’ll mark it done.</p>{hoursLeft !== null && hoursLeft < 48 && <p>{hoursLeft > 0 ? Math.ceil(hoursLeft) : 0}h left</p>}</div>}
  </div>;
}
