"use client";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { TextLink } from "@/components/TextLink";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { OfflineBanner, useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { Skeleton, SkeletonText } from "@/components/feedback/Skeleton";
import { MoneyField, TextAreaField, TextField } from "@/components/forms/TextFields";
import { CheckboxField } from "@/components/forms/ChoiceFields";
import { PhotoPicker, type PickedPhoto } from "@/components/media/PhotoPicker";
import { PhotoGallery } from "@/components/media/PhotoGallery";
import { DropZone } from "@/components/media/DropZone";
import { ProgressRing, type UploadStatus } from "@/components/media/ProgressRing";
import { BoltFlash } from "@/components/motion/BoltFlash";
import { Banner } from "@/components/overlays/Banner";
import { ToastProvider, useToast } from "@/components/overlays/Toast";
import { Tracker } from "@/components/status/Tracker";
import { formatCents } from "@/components/status/PriceBlock";
import { jobTracker } from "@/lib/job-tracker";
import { FINISH_DECLARATION, clearFinishReason, finishErrors, finishReasonKey, finishSpend, keepFinishReason, readFinishReason, type FinishErrors, type FinishFields, type FinishResult, type FinishState, type FinishUploadResult, type FinishView } from "@/lib/finish-job";
import type { AuthFailure } from "@/lib/auth/results";
import { removeEvidencePhotoAction, saveFinishDraftAction, sendForSignOffAction } from "@/server/jobs/evidence-actions";
import styles from "./finish-job.module.css";
import { useWorkspaceReturn } from "./use-workspace-return";

type DocumentState = { url: string; name: string; size?: number; status: UploadStatus; error?: string };
type UploadKind = "photo" | "coc" | "receipt";
type Props = { job: FinishView & { officeNote?: string | null }; preview?: FinishState; embedded?: boolean;
  save?: (id: string, fields: FinishFields) => Promise<FinishResult | AuthFailure>;
  send?: (id: string, fields: FinishFields) => Promise<FinishResult | AuthFailure>;
  remove?: (id: string, photo: string) => Promise<FinishResult | AuthFailure>;
  upload?: (id: string, kind: UploadKind, file: File, requestId: string) => Promise<FinishUploadResult | AuthFailure> };
async function uploadFile(id: string, kind: UploadKind, file: File, requestId: string): Promise<FinishUploadResult | AuthFailure> {
  const body = new FormData(); body.set("kind", kind); body.set("file", file); body.set("requestId", requestId);
  const response = await fetch(`/api/jobs/${id}/evidence`, { method: "POST", body });
  if (response.status === 401) return { ok: false, error: "session-expired", values: {} };
  if (response.status === 403) return { ok: false, error: "forbidden" };
  return response.json();
}
const storageUnavailable = "finish-browser-storage-unavailable";
const subscribeReason = (changed: () => void) => { window.addEventListener("storage", changed); return () => window.removeEventListener("storage", changed); };
export function FinishJob(props: Props) { return <ToastProvider initial={props.preview === "draft-saved" ? { message: "Saved for later." } : undefined}><FinishContent {...props} /></ToastProvider>; }
function FinishContent({ job, preview, embedded, save = saveFinishDraftAction, send = sendForSignOffAction, remove = removeEvidencePhotoAction, upload = uploadFile }: Props) {
  const router = useRouter(), session = useOptionalSessionExpired(), toast = useToast(), online = useOnlineStatus(), pending = useRef(false), lastIntent = useRef<"save" | "send">("save"), retryRemove = useRef<string | null>(null), form = useRef<HTMLFormElement>(null);
  const [storedFields, setFields] = useState(job.fields), [reasonEdited, setReasonEdited] = useState(false), [photos, setPhotos] = useState<PickedPhoto[]>(() => job.photos.map((photo, i) => ({ ...photo, status: preview === "uploading" && i === 0 ? "uploading" : preview === "upload-error" && i === 0 ? "failed" : "done", progress: .5 })));
  const [coc, setCoc] = useState<DocumentState | null>(job.cocDocument ? { ...job.cocDocument, status: preview === "upload-error" ? "failed" : "done", ...(preview === "upload-error" ? { error: "Couldn’t upload this file. Try again." } : {}) } : null), [receipt, setReceipt] = useState<DocumentState | null>(job.receipt ? { ...job.receipt, status: "done" } : null);
  const [busy, setBusy] = useState<"save" | "send" | "remove" | null>(null), [sent, setSent] = useState(preview === "sent"), [eventId, setEventId] = useState("finish-preview");
  const [problems, setProblems] = useState<string[]>([]), [error, setError] = useState(preview === "error"), [storageError, setStorageError] = useState(false), [cleanupError, setCleanupError] = useState(false);
  const [errors, setErrors] = useState<FinishErrors>(() => preview === "field-errors" ? finishErrors(job.fields, { rule: job.rule, photoCount: job.photos.length, cocFile: Boolean(job.cocDocument), receipt: Boolean(job.receipt), budgetCents: job.budgetCents, category: job.category, extraWorkOpen: job.extraWorkOpen }) : {});
  const files = useRef(new Map<string, File>()), localUrls = useRef(new Set<string>()), reasonKept = useRef(false);
  // Same external-store hydration pattern as the existing post-job draft. Snapshot keys
  // follow the current owner/job; no deferred restore can overwrite another form or live edits.
  const reasonSnapshot = useSyncExternalStore(subscribeReason, useCallback(() => {
    if (preview) return "";
    try { return localStorage.getItem(finishReasonKey(job.ownerId, job.id)) ?? ""; } catch { return storageUnavailable; }
  }, [job.ownerId, job.id, preview]), () => "");
  const fields = { ...storedFields, reason: !preview && !job.readOnly && !reasonEdited ? readFinishReason(reasonSnapshot, job.ownerId, job.id) || storedFields.reason : storedFields.reason };
  const offline = !online || preview === "offline", saving = Boolean(busy) || preview === "sending", readOnly = job.readOnly;
  const uploading = photos.some(photo => photo.status === "uploading") || coc?.status === "uploading" || receipt?.status === "uploading";
  const failed = photos.some(photo => photo.status === "failed") || coc?.status === "failed" || receipt?.status === "failed";
  const spent = job.budgetCents > 0 ? finishSpend(fields.spent) : 0, over = spent !== null && spent > job.budgetCents;
  const descriptionId = useId();
  const jobHref = useWorkspaceReturn(`/jobs/${job.id}`), region = (label: string) => embedded ? `${label} (${preview})` : label;
  useEffect(() => { const urls = localUrls.current; return () => { for (const url of urls) URL.revokeObjectURL(url); }; }, []);
  useEffect(() => { if (!sent || preview || cleanupError) return; const timer = setTimeout(() => router.push(jobHref), 900); return () => clearTimeout(timer); }, [sent, preview, cleanupError, router, jobHref]);
  function change<K extends keyof FinishFields>(key: K, value: FinishFields[K]) { if (key === "reason") setReasonEdited(true); setFields(previous => ({ ...previous, [key]: value })); setErrors(previous => ({ ...previous, [key]: undefined })); setError(false); }
  function clearReason() { try { return clearFinishReason(localStorage, job.ownerId, job.id); } catch { return false; } }
  function failedUpload(kind: UploadKind, id: string, message: string) {
    if (kind === "photo") { setPhotos(previous => previous.map(photo => photo.id === id ? { ...photo, status: "failed" } : photo)); setProblems([message]); }
    else (kind === "coc" ? setCoc : setReceipt)(previous => previous ? { ...previous, status: "failed", error: message } : null);
  }
  async function put(kind: UploadKind, file: File, id: string) {
    try {
      const result = await upload(job.id, kind, file, id); if (session?.check(result)) { failedUpload(kind, id, "Couldn’t upload this file. Try again."); return; }
      if (!("status" in result) || result.status !== "uploaded") { failedUpload(kind, id, "message" in result && result.message ? result.message : "Couldn’t upload this file. Try again."); return; }
      if (kind === "photo") setPhotos(previous => previous.map(photo => photo.id === id ? { ...photo, src: result.file.url, status: "done" } : photo));
      else (kind === "coc" ? setCoc : setReceipt)({ ...result.file, status: "done" });
      files.current.delete(id); setErrors(previous => ({ ...previous, [kind === "photo" ? "photos" : kind === "coc" ? "cocDocument" : "receipt"]: undefined }));
    } catch {
      failedUpload(kind, id, "Couldn’t upload this file. Try again.");
    }
  }
  function addPhotos(chosen: File[]) {
    if (offline || saving || readOnly || uploading) return;
    const room = Math.max(0, 10 - photos.length), accepted = chosen.slice(0, room); setProblems(chosen.length > room ? ["Add up to 10 photos."] : []);
    for (const file of accepted) {
      const id = crypto.randomUUID(), src = URL.createObjectURL(file); localUrls.current.add(src); files.current.set(id, file);
      setPhotos(previous => [...previous, { id, src, name: file.name, status: "uploading" }]); void put("photo", file, id);
    }
  }
  function addDocument(kind: "coc" | "receipt", chosen: File[]) {
    const file = chosen[0]; if (!file || offline || saving || uploading || readOnly) return;
    files.current.set(kind, file); (kind === "coc" ? setCoc : setReceipt)({ url: "", name: file.name, size: file.size, status: "uploading" }); void put(kind, file, kind);
  }
  function retry(kind: UploadKind, id: string) {
    if (offline || saving || uploading || readOnly) return;
    const file = files.current.get(id); if (kind === "photo") setProblems([]);
    if (!file) { if (preview) { if (kind === "photo") setPhotos(previous => previous.map(photo => photo.id === id ? { ...photo, status: "done" } : photo)); else (kind === "coc" ? setCoc : setReceipt)(previous => previous ? { ...previous, status: "done", error: undefined } : null); } else failedUpload(kind, id, "Choose the file again."); return; }
    if (kind === "photo") setPhotos(previous => previous.map(photo => photo.id === id ? { ...photo, status: "uploading" } : photo));
    else (kind === "coc" ? setCoc : setReceipt)(previous => previous ? { ...previous, status: "uploading", error: undefined } : null);
    void put(kind, file, id);
  }
  async function removePhoto(id: string) {
    if (pending.current || offline || saving || uploading || readOnly) return;
    retryRemove.current = id; pending.current = true; setBusy("remove"); setError(false);
    try { const result = await remove(job.id, id); if (session?.check(result)) return; if (!("status" in result) || result.status !== "saved") { setError(true); return; } files.current.delete(id); setPhotos(previous => previous.filter(photo => photo.id !== id)); setProblems([]); }
    catch { setError(true); } finally { pending.current = false; setBusy(null); }
  }
  async function submit(kind: "save" | "send", event?: FormEvent) {
    event?.preventDefault(); if (pending.current || offline || saving || uploading || failed || readOnly || sent) return;
    if (kind === "send") {
      const invalid = finishErrors(fields, { rule: job.rule, photoCount: photos.filter(photo => photo.status === "done").length, cocFile: coc?.status === "done", receipt: receipt?.status === "done", budgetCents: job.budgetCents, category: job.category, extraWorkOpen: job.extraWorkOpen });
      if (Object.keys(invalid).length) { setErrors(invalid); requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return; }
    }
    if (kind === "save" && (over || fields.reason.trim()) && !preview) {
      let durable = false; try { durable = keepFinishReason(localStorage, job.ownerId, job.id, fields.reason); } catch { /* Access to localStorage itself can throw. */ }
      if (!durable) { setStorageError(true); return; }
      reasonKept.current = true; setStorageError(false);
    }
    retryRemove.current = null; lastIntent.current = kind; pending.current = true; setBusy(kind); setError(false); setErrors({});
    try {
      const result = await (kind === "save" ? save : send)(job.id, fields); if (session?.check(result)) return;
      if (!("status" in result)) { setError(true); return; }
      if (result.status === "invalid") setErrors(result.fields);
      else if (result.status === "saved") toast.show({ message: "Saved for later." });
      else if (result.status === "sent") {
        if (!preview && (reasonKept.current || reasonSnapshot !== "") && !clearReason()) setCleanupError(true);
        setEventId(`finish:${job.id}:${Date.now()}`); setSent(true);
      } else setError(true);
    } catch { setError(true); } finally { pending.current = false; setBusy(null); }
  }
  const sendDisabled = offline || uploading || failed || saving || !fields.declaration || !job.rule || job.extraWorkOpen;
  const tracker = jobTracker("SUBMITTED", "tradie", { evidence: job.rule?.cocRequired ? "coc" : "photos" })!;
  tracker.steps = tracker.steps.map(step => step.label === "Customer signs off" ? { ...step, note: `or ${job.autoReleaseHours} hours` } : step);
  const heading = <>{embedded ? <h3>Finish up</h3> : <h1>Finish up</h1>}<p className={styles.intro}>{job.customerFirstName} gets {job.autoReleaseHours} hours to check. Then you’re paid next payroll.</p></>;
  return <section className={styles.canvas} data-mode="trade" aria-label={embedded ? `Finish ${preview}` : undefined}><div className={styles.page}>
    {!embedded && <nav aria-label="Breadcrumb" className={styles.breadcrumb}><TextLink href={jobHref}>{job.title}</TextLink><Icon name="chevron_right" size="sm" decorative /><span>Finish job</span></nav>}{heading}
    <OfflineBanner online={preview === "offline" ? false : undefined} sticky={false} />
    {job.officeNote && !sent && <Banner tone="alert">The office sent this back: {job.officeNote}</Banner>}
    {sent ? <section className={`${styles.card} ${styles.sent}`} aria-label={region("Sent for sign-off")}><BoltFlash eventId={eventId} mark="bolt" size={96} /><h2>Sent for sign-off</h2>{cleanupError && <Banner tone="alert" action={<Button variant="tertiary" onClick={() => { if (clearReason()) setCleanupError(false); }}>Try again</Button>}>Sent, but this browser’s draft couldn’t be cleared.</Banner>}<Tracker {...tracker} /><TextLink href={jobHref}>Back to the job</TextLink></section> : <>
      {job.readOnly && <Banner tone="good">Sent for sign-off</Banner>}
      {job.readOnly && cleanupError && <Banner tone="alert" action={<Button variant="tertiary" onClick={() => { if (clearReason()) setCleanupError(false); }}>Try again</Button>}>Sent, but this browser’s draft couldn’t be cleared.</Banner>}
      {job.extraWorkOpen && !readOnly && <Banner tone="info">Extra work is waiting on the customer’s OK.</Banner>}
      {!job.rule && <Banner tone="info" action={<TextLink href="/contact" inline>Contact us</TextLink>}>This trade isn’t set up for finishing jobs yet. Contact us.</Banner>}
      <form className={styles.card} ref={form} noValidate onSubmit={event => void submit("send", event)}>
        {error && <Banner tone="alert" live action={<Button variant="tertiary" disabled={offline || saving} onClick={() => retryRemove.current ? void removePhoto(retryRemove.current) : void submit(lastIntent.current)}>Try again</Button>}>Couldn’t save this job. Try again.</Banner>}
        {(storageError || !readOnly && reasonSnapshot === storageUnavailable && over) && <Banner tone="alert" live>Your over-budget reason couldn’t be saved on this browser. Keep this page open and try Save for later again.</Banner>}
        {errors.form && <Banner tone="alert" live>{errors.form}</Banner>}
        <section aria-label={region("Photos of the finished work")}><h2 className={styles.label}>Photos of the finished work</h2>{readOnly ? photos.length ? <PhotoGallery photos={photos.map(photo => ({ src: photo.src, alt: photo.name }))} label={region("Finished work")} /> : <p>No photos added.</p> : <fieldset className={styles.picker} disabled={offline || saving || uploading}><legend className={styles.srOnly}>{region("Finished work photos")}</legend><PhotoPicker photos={photos} max={10} addLabel="Add" label={region("Finished work photos")} onAdd={addPhotos} onRemove={id => void removePhoto(id)} onRetry={id => retry("photo", id)} problems={problems} retryDisabled={offline || saving || uploading} /></fieldset>}{errors.photos && <p className={styles.error}>{errors.photos}</p>}</section>
        <div className={styles.cocFields}>
          {job.rule?.cocRequired && <TextField label="CoC number" name="cocNumber" required value={fields.cocNumber} maxLength={200} readOnly={readOnly} disabled={saving} error={errors.cocNumber} onChange={event => change("cocNumber", event.target.value)} />}
          {job.rule?.cocFileRequired && <DocumentField label="CoC document" document={coc} error={coc?.error ?? errors.cocDocument} disabled={offline || saving || uploading} readOnly={readOnly} onFiles={files => addDocument("coc", files)} onRetry={() => retry("coc", "coc")} region={region("CoC document")} />}
        </div>
        <TextAreaField label="Notes" name="notes" required={job.rule?.notesRequired} value={fields.notes} maxLength={4000} readOnly={readOnly} disabled={saving} error={errors.notes} onChange={event => change("notes", event.target.value)} />
        {job.budgetCents > 0 && <section className={styles.materials} aria-label={region("Materials")}><MoneyField label={job.category === "ELECTRICAL" ? "Telfer spend" : "Materials spend"} name="spent" value={fields.spent} readOnly={readOnly} disabled={saving} aria-describedby={`${descriptionId}-budget`} error={errors.spent} onChange={event => change("spent", event.target.value)} /><p id={`${descriptionId}-budget`} className={styles.hint}>Budget {formatCents(job.budgetCents)}</p>{job.category !== "ELECTRICAL" && spent !== null && spent > 0 && <DocumentField label="Receipt" document={receipt} error={receipt?.error ?? errors.receipt} disabled={offline || saving || uploading} readOnly={readOnly} onFiles={files => addDocument("receipt", files)} onRetry={() => retry("receipt", "receipt")} region={region("Receipt")} />}{over && <><TextAreaField label="Why was it over?" name="reason" required value={fields.reason} maxLength={2000} readOnly={readOnly} disabled={saving} error={errors.reason} aria-describedby={`${descriptionId}-office`} onChange={event => change("reason", event.target.value)} /><p id={`${descriptionId}-office`} className={styles.hint}>The office checks this before you’re paid.</p></>}</section>}
        <CheckboxField label={FINISH_DECLARATION} name="declaration" checked={fields.declaration} disabled={readOnly || saving} error={errors.declaration} onChange={event => change("declaration", event.target.checked)} />
        {!readOnly && <div className={styles.actions}><Button variant="secondary" type="button" loading={busy === "save"} disabled={offline || saving || uploading || failed} onClick={() => void submit("save")}>Save for later</Button><Button type="submit" loading={busy === "send" || preview === "sending"} disabled={job.extraWorkOpen ? "Extra work is waiting on the customer’s OK." : sendDisabled}>Send for sign-off</Button></div>}
      </form>
    </>}
  </div></section>;
}
function DocumentField({ label, document, error, disabled, readOnly, onFiles, onRetry, region }: { label: string; document: DocumentState | null; error?: string; disabled: boolean; readOnly: boolean; onFiles: (files: File[]) => void; onRetry: () => void; region: string }) {
  return <section className={styles.document} aria-label={region}><h2 className={styles.label}>{label}</h2>{document && <div className={styles.file}><Icon name="description" decorative /><div>{document.url && document.status === "done" ? <TextLink href={document.url} external>{document.name}</TextLink> : <b>{document.name}</b>}{document.size !== undefined && <p className={styles.hint}>{Math.max(1, Math.ceil(document.size / 1024))} KB</p>}</div><ProgressRing className={styles.documentTick} status={document.status} label={document.name} size={28} />{document.status === "failed" && !readOnly && <Button variant="tertiary" onClick={onRetry} disabled={disabled}>Retry</Button>}</div>}{!readOnly && <DropZone title={document ? "Replace file" : "Add file"} accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.heic,.heif" multiple={false} hint="PDF, JPG, PNG or HEIC up to 10 MB" disabled={disabled ? "Upload unavailable right now." : undefined} onFiles={onFiles} />}{error && <p className={styles.error}>{error}</p>}</section>;
}
export function FinishLoading({ embedded = false }: { embedded?: boolean }) { return <section className={styles.canvas} data-mode="trade"><div className={styles.page} role="status" aria-label="Loading finish job">{!embedded && <h1 className={styles.srOnly}>Finish job</h1>}<SkeletonText /><div className={styles.card}><Skeleton height={130} /><SkeletonText /><Skeleton height={60} /><Skeleton height={60} /></div></div></section>; }
export function FinishLoadError({ embedded = false, retry }: { embedded?: boolean; retry?: () => void }) { const router = useRouter(); return <section className={styles.canvas} data-mode="trade"><div className={styles.page}><div className={styles.card}>{embedded ? <h3>Couldn’t load this job</h3> : <h1>Couldn’t load this job</h1>}<Banner tone="alert">Try again</Banner><Button onClick={() => retry ? retry() : router.refresh()}>Try again</Button></div></div></section>; }
