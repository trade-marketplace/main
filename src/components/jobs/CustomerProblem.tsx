"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, IconButton } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { Skeleton } from "@/components/feedback/Skeleton";
import { OfflineBanner, useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { CheckboxField } from "@/components/forms/ChoiceFields";
import { TextAreaField, TextField } from "@/components/forms/TextFields";
import { Banner } from "@/components/overlays/Banner";
import type { AuthFailure } from "@/lib/auth/results";
import { CUSTOMER_PROBLEM_ERRORS, customerProblemSchema, type CustomerProblemContext, type CustomerProblemInput, type CustomerProblemReceipt, type CustomerProblemResult, type CustomerProblemState } from "@/lib/customer-problem";
import { uploadSupportPhotoClient } from "@/lib/support-photo-upload";
import { reportCustomerProblemAction } from "@/server/jobs/customer-problem-actions";
import styles from "./customer-problem.module.css";

type Photo = { id: string; name: string; url: string | null; path?: string; file?: File; failed?: boolean };
type Props = { job: CustomerProblemContext; initialReport?: CustomerProblemReceipt | null; state?: CustomerProblemState; preview?: boolean; backHref?: string;
  save?: (input: CustomerProblemInput) => Promise<CustomerProblemResult | AuthFailure>; upload?: (jobId: string, file: File) => Promise<string> };

export function CustomerProblem({ job, initialReport = null, state = "form", preview = false, backHref = `/jobs/${job.id}`, save = reportCustomerProblemAction, upload = uploadSupportPhotoClient }: Props) {
  const router = useRouter(), session = useOptionalSessionExpired(), browserOnline = useOnlineStatus();
  const offline = !browserOnline || state === "offline";
  const populated = ["error", "offline", "saving", "urgent", "photos", "uploading"].includes(state);
  const [topic, setTopic] = useState(state === "urgent" ? "Exposed wires" : populated ? "Work not finished" : "");
  const [details, setDetails] = useState(state === "urgent" ? "There are exposed wires beside the switch." : populated ? "The light switch is still loose. I’ve added a photo of the problem." : "");
  const [urgent, setUrgent] = useState(state === "urgent");
  const [photos, setPhotos] = useState<Photo[]>(["photos", "uploading"].includes(state) ? [{ id: "preview-photo", name: "Light switch.jpg", url: "/images/examples/switch.jpg", ...(state === "photos" ? { path: "preview" } : {}) }] : []);
  const [report, setReport] = useState(initialReport);
  const [error, setError] = useState(state === "error" ? CUSTOMER_PROBLEM_ERRORS.unavailable : "");
  const [invalid, setInvalid] = useState(false), [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false);
  const pending = useRef(false), adding = useRef(false), requestKey = useRef<string | null>(null);
  const urls = useRef(new Set<string>()), form = useRef<HTMLFormElement>(null), fileInput = useRef<HTMLInputElement>(null), sentHeading = useRef<HTMLHeadingElement>(null);
  const photoBusy = uploading || state === "uploading", saving = busy || state === "saving";
  useEffect(() => { const active = urls.current; return () => { for (const url of active) URL.revokeObjectURL(url); }; }, []);
  function changed() { requestKey.current = null; setError(""); setInvalid(false); }
  async function uploadOne(photo: Photo) {
    if (!photo.file) return;
    try {
      const path = await upload(job.id, photo.file);
      setPhotos(previous => previous.map(item => item.id === photo.id ? { ...item, path, failed: false } : item));
    } catch (cause) {
      setPhotos(previous => previous.map(item => item.id === photo.id ? { ...item, failed: true } : item));
      setError(cause instanceof Error && cause.message === "photo-too-large" ? CUSTOMER_PROBLEM_ERRORS["photo-too-large"] : CUSTOMER_PROBLEM_ERRORS["photos-pending"]);
    }
  }
  async function addPhotos(files: FileList | null) {
    if (!files?.length || adding.current || pending.current || offline) return;
    const remaining = 6 - photos.length;
    if (files.length > remaining) { setError("Choose up to 6 photos."); if (fileInput.current) fileInput.current.value = ""; return; }
    changed(); adding.current = true; setUploading(true);
    const added = Array.from(files).map(file => { const url = ["image/jpeg", "image/png"].includes(file.type) ? URL.createObjectURL(file) : null; if (url) urls.current.add(url); return { id: crypto.randomUUID(), file, name: file.name, url }; });
    setPhotos(previous => [...previous, ...added]);
    try { for (const photo of added) await uploadOne(photo); }
    finally { adding.current = false; setUploading(false); if (fileInput.current) fileInput.current.value = ""; }
  }
  async function retryPhoto(photo: Photo) {
    if (adding.current || pending.current || offline) return;
    changed(); adding.current = true; setUploading(true);
    try { await uploadOne(photo); } finally { adding.current = false; setUploading(false); }
  }
  async function send() {
    if (pending.current || adding.current || offline || photoBusy || saving || photos.some(photo => !photo.path)) return;
    requestKey.current ??= crypto.randomUUID();
    const input = { jobId: job.id, topic, details, urgent, photoPaths: photos.map(photo => photo.path!), requestKey: requestKey.current };
    if (!customerProblemSchema.safeParse(input).success) {
      setInvalid(true); form.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(!topic.trim() ? '[name="topic"]' : '[name="details"]')?.focus(); return;
    }
    pending.current = true; setBusy(true); setError("");
    try {
      const result = await save(input);
      if (session?.check(result, { resend: send })) return;
      if (result.ok) {
        setReport(result.report);
        if (!preview) router.replace(`/jobs/${job.id}/problem?report=${result.report.id}&from=${encodeURIComponent(backHref)}`);
        requestAnimationFrame(() => sentHeading.current?.focus());
      } else setError(CUSTOMER_PROBLEM_ERRORS[result.error] ?? CUSTOMER_PROBLEM_ERRORS.unavailable);
    } catch { setError(CUSTOMER_PROBLEM_ERRORS.unavailable); }
    finally { pending.current = false; setBusy(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void send(); }
  if (state === "loading") return <CustomerProblemLoading backHref={backHref} />;
  return <div className={styles.canvas} data-mode="customer"><section className={styles.page}>
    <Button href={backHref} variant="tertiary" width="auto" icon="arrow_back">Back</Button>
    <div className={styles.card}>
      <header className={styles.header}><p className={styles.eyebrow}>TM-{job.jobNumber}</p><h1 className={styles.title} ref={sentHeading} tabIndex={-1}>{report ? "Sent." : "Report a problem"}</h1><p className={styles.job}>{job.title}</p></header>
      {report ? <>
        <Banner tone="good" title="Your report has been sent to the office." live />
        {report.releasePaused && <Banner tone="info" title="Auto-release is paused while your report is open." />}
        {report.urgent && <Banner tone="alert" title="Call 111 if dangerous.">Your report is flagged as urgent for the office.</Banner>}
        <dl className={styles.summary}><div><dt>Topic</dt><dd>{report.topic}</dd></div><div><dt>Details</dt><dd>{report.details}</dd></div>{report.photoCount > 0 && <div><dt>Photos</dt><dd>{report.photoCount}</dd></div>}</dl>
        <Button href={backHref}>Back to job</Button>
      </> : <>
        <OfflineBanner online={state === "offline" ? false : undefined} sticky={false} />
        <Banner tone={urgent ? "alert" : "info"} title="Call 111 if dangerous." />
        {error && <Banner tone="alert" title={error} live />}
        <form ref={form} onSubmit={submit} noValidate data-offline-queue="off" className={styles.form}>
          <TextField name="topic" label="Topic" required maxLength={160} value={topic} disabled={saving} error={invalid && !topic.trim() ? "Add a topic." : undefined} onChange={event => { changed(); setTopic(event.target.value); }} />
          <TextAreaField name="details" label="Details" required rows={5} maxLength={4000} value={details} disabled={saving} error={invalid && !details.trim() ? "Add details." : undefined} onChange={event => { changed(); setDetails(event.target.value); }} />
          <CheckboxField label="Urgent / safety" checked={urgent} disabled={saving} onChange={event => { changed(); setUrgent(event.target.checked); }} />
          <div className={styles.photoSection} role="group" aria-labelledby="problem-photos-title">
            <div className={styles.photoHeading}><h2 id="problem-photos-title">Photos <span>(optional)</span></h2><span>{photos.length} / 6</span></div>
            {photos.length ? <ul className={styles.photos}>{photos.map((photo, index) => <li key={photo.id} className={styles.photo}>
              {photo.url ? /* Blob previews stay local; uploaded files remain in the private bucket. */
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo.url} alt={`Problem photo ${index + 1}`} onError={() => { setPhotos(previous => previous.map(item => item.id === photo.id ? { ...item, url: null } : item)); if (photo.url && urls.current.delete(photo.url)) URL.revokeObjectURL(photo.url); }} /> : <span className={styles.photoIcon}><Icon name="photo" decorative /></span>}
              <div className={styles.photoWords}><span className={styles.fileName}>{photo.name}</span><span className={styles.caption}>{photo.failed ? "Photo not uploaded" : photo.path ? "Uploaded" : "Uploading…"}</span>
                {photo.failed && <Button variant="tertiary" disabled={offline || photoBusy || saving} onClick={() => void retryPhoto(photo)}>Try again</Button>}</div>
              <IconButton icon="close" label={`Remove photo ${index + 1}`} disabled={photoBusy || saving} onClick={() => { changed(); setPhotos(previous => previous.filter(item => item.id !== photo.id)); if (photo.url && urls.current.delete(photo.url)) URL.revokeObjectURL(photo.url); }} />
            </li>)}</ul> : <p className={styles.caption}>No photos added.</p>}
            <input ref={fileInput} id="problem-photo-upload" type="file" accept="image/jpeg,image/png,image/heic,image/heif" multiple className={styles.srOnly} tabIndex={-1} aria-label="Choose photos" disabled={offline || photoBusy || saving || photos.length >= 6} onChange={event => void addPhotos(event.target.files)} />
            <Button variant="secondary" icon="add_photo_alternate" disabled={offline ? "You’re offline" : photos.length >= 6 ? "Choose up to 6 photos." : photoBusy || saving} onClick={() => fileInput.current?.click()}>Add photos</Button>
            {photoBusy && <p role="status" className={styles.caption}>Uploading photos…</p>}
          </div>
          <div className={styles.actions}><Button type="submit" width="full" loading={saving} disabled={offline ? "You’re offline" : photoBusy || photos.some(photo => !photo.path) ? "Finish uploading your photos first." : false}>Send report</Button></div>
        </form>
      </>}
    </div>
  </section></div>;
}

export function CustomerProblemLoading({ backHref = "/" }: { backHref?: string }) {
  return <div className={styles.canvas} data-mode="customer"><section className={styles.page}><Button href={backHref} variant="tertiary" icon="arrow_back">Back</Button><div className={styles.card} aria-busy="true" role="status" aria-label="Loading report form"><h1 className={styles.srOnly}>Report a problem</h1><Skeleton width="30%" /><Skeleton width="75%" height="2.5rem" /><Skeleton height="4rem" /><Skeleton height="3.5rem" /><Skeleton height="10rem" /><Skeleton height="3.5rem" /></div></section></div>;
}
export function CustomerProblemLoadError({ backHref = "/" }: { backHref?: string }) {
  const router = useRouter();
  return <div className={styles.canvas} data-mode="customer"><section className={styles.page}><Button href={backHref} variant="tertiary" icon="arrow_back">Back</Button><div className={styles.card}><h1 className={styles.title}>Couldn’t load the report form.</h1><p>Check your connection and try again.</p><Button onClick={() => router.refresh()}>Try again</Button></div></section></div>;
}
