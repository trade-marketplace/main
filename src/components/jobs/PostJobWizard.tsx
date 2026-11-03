"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Wordmark } from "@/components/Wordmark";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { OfflineBanner, useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { Skeleton } from "@/components/feedback/Skeleton";
import { ChipGroup } from "@/components/forms/ChoiceFields";
import { TextAreaField } from "@/components/forms/TextFields";
import { Banner } from "@/components/overlays/Banner";
import { ToastProvider } from "@/components/overlays/Toast";
import { PhotoThumbnail } from "@/components/media/PhotoPicker";
import { DRAFT_STORAGE_KEY, type JobDraft } from "@/lib/job-draft";
import { wentUp } from "@/lib/motion/helpers";
import { useBump } from "@/lib/motion/hooks";
import { canonicalDraft, decodeWizardDraft, describeErrors, editDescription, encodeWizardDraft, initialWizardDraft, JOB_TYPES, WIZARD_STEPS, type WizardDraft } from "@/lib/post-job-wizard";
import type { saveDraftAction } from "@/server/jobs/actions";
import { DraftPhotos } from "./DraftPhotos";
import { useDraftPhotos } from "./useDraftPhotos";

import styles from "./post-job.module.css";

type Props = {
  ownerId?: string | null;
  initialDraft?: JobDraft;
  hasServerDraft?: boolean;
  loadFailed?: boolean;
  save: typeof saveDraftAction;
  /** Only the guarded component preview passes this. */
  previewState?: string;
};
function subscribeDraft(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
function snapshot() { try { return localStorage.getItem(DRAFT_STORAGE_KEY); } catch { return null; } }

export function WizardFrame({ step = 0, saved, saveExit, children, summary, backHref, busy, stepHrefs, photoPreviews }: {
  step?: number; saved?: boolean; saveExit?: () => void; children: ReactNode; summary?: WizardDraft; backHref?: string; busy?: boolean; stepHrefs?: readonly string[]; photoPreviews?: readonly { src: string; name: string }[];
}) {
  const run = useBump(step, wentUp);
  return <div className={styles.page} data-mode="customer">
    <header className={styles.nav}>
      <Link href="/" className={styles.logo}><Wordmark /></Link>
      <div className={styles.navActions}>
        {saved && <span className={styles.saved} role="status">Draft saved <Icon name="cloud_done" size="sm" decorative /></span>}
        <Button variant="secondary" size="sm" width="auto" className={styles.exit} onClick={saveExit} disabled={!saveExit} loading={busy}>Save &amp; exit</Button>
      </div>
    </header>
    <div className={styles.wrap}>
      <nav className={styles.rail} aria-label="Post a job">
        <p className={styles.eyebrow}>Post a job</p>
        <ol className={styles.steps}>
          {WIZARD_STEPS.map((label, i) => <li key={label} data-state={i < step ? "done" : i === step ? "now" : "todo"} aria-current={i === step ? "step" : undefined}>
            <span key={i === step ? run : 0} className={`${styles.stepDot} ${i === step && run ? "tm-anim-step-dot" : ""}`} aria-hidden="true">{i < step ? <Icon name="check" size="sm" decorative /> : i + 1}</span>
            {i < step && (stepHrefs?.[i] ?? backHref) ? <Link href={stepHrefs?.[i] ?? backHref!}>{label}<span className={styles.srOnly}>: Done</span></Link> : <span>{label}<span className={styles.srOnly}>: {i === step ? "Now" : "To do"}</span></span>}
          </li>)}
        </ol>
      </nav>
      <main id="main" className={`${styles.main} tm-anim-rise`}>
        <p className={styles.phoneStep}>Post a job <span>Step {step + 1} of 4</span></p>
        <div className={styles.progress} aria-hidden="true">{WIZARD_STEPS.map((label, i) => <span key={label} data-done={i <= step} className={i === step && run ? "tm-anim-fill" : undefined} />)}</div>
        <div className={styles.card}>{children}</div>
      </main>
      <aside className={`${styles.summary} ${styles.card}`} aria-label="Your job">
        <h2 className={styles.eyebrow}>Your job</h2>
        {Boolean(photoPreviews?.length) && <div className={styles.summaryPhotos}>{photoPreviews!.slice(0, 3).map((photo, index) => <span className={styles.summaryPhoto} key={`${photo.src}-${index}`}><PhotoThumbnail photo={photo} index={index} /></span>)}</div>}
        {summary?.data.category && <span className={styles.category}>{JOB_TYPES.find((item) => item.value === summary.data.category)?.label}</span>}
        {summary?.description && <p className={styles.summaryText}>{summary.description}</p>}
        <Banner tone="brand" icon="lock" className={styles.summaryTrust}>Free to post. You only pay if you accept the price.</Banner>
      </aside>
    </div>
  </div>;
}

export function PostJobWizard({ ownerId = null, initialDraft = {}, hasServerDraft = false, loadFailed = false, save, previewState }: Props) {
  return <ToastProvider><PostJobWizardForm {...{ ownerId, initialDraft, hasServerDraft, loadFailed, save, previewState }} /></ToastProvider>;
}

function PostJobWizardForm({ ownerId = null, initialDraft = {}, hasServerDraft = false, loadFailed = false, save, previewState }: Props) {
  const router = useRouter(); const path = usePathname(); const params = useSearchParams();
  const raw = useSyncExternalStore(subscribeDraft, snapshot, () => null);
  const restored = previewState ? null : decodeWizardDraft(raw, ownerId);
  const [edited, setEdited] = useState<WizardDraft>();
  const draft = edited ?? restored ?? initialWizardDraft(initialDraft, hasServerDraft || previewState === "photos");
  const photos = useDraftPhotos({ ownerId, postKey: draft.data.postKey, serverPaths: draft.data.photoPaths ?? [], preview: Boolean(previewState) });
  const [saved, setSaved] = useState<boolean>();
  const [error, setError] = useState(previewState === "save-error");
  const [fields, setFields] = useState<Record<string, string>>(previewState === "invalid" ? { description: "Describe the job", category: "Type of job" } : {});
  const [busy, setBusy] = useState(previewState === "saving"); const pending = useRef(false);
  const descriptionRef = useRef<HTMLTextAreaElement>(null); const headingRef = useRef<HTMLHeadingElement>(null);
  const session = useOptionalSessionExpired(); const online = useOnlineStatus();
  const offline = !online || previewState === "offline";
  const describeValid = !Object.keys(describeErrors(draft)).length;
  const requestedStep = params.get("step") ?? (previewState === "photos" ? "photos" : "describe");
  const described = draft.completedDescribe && describeValid && Boolean(draft.data.postKey);
  const step = described && requestedStep === "where-when" && draft.completedPhotos ? 2 : described && (requestedStep === "photos" || requestedStep === "where-when") ? 1 : 0;
  const stepHref = (value: string) => { const query = new URLSearchParams(params.toString()); query.set("step", value); return `${path}?${query}`; };
  const stepHrefs = [stepHref("describe"), stepHref("photos"), stepHref("where-when")];
  const backHref = step === 2 ? stepHrefs[1] : stepHrefs[0];
  const nextHref = step === 0 ? stepHrefs[1] : stepHrefs[2];
  const effectiveDraft = { ...draft, data: { ...draft.data, ...(photos.active && !photos.state.restoring ? { photoPaths: photos.manager.paths() } : {}) } };
  const restoredNotice = previewState === "restored" || Boolean(!edited && (restored || hasServerDraft));
  const previousStep = useRef(step);
  useEffect(() => {
    if (previousStep.current !== step) headingRef.current?.focus();
    previousStep.current = step;
  }, [step]);

  function keep(next: WizardDraft) {
    const withKey = { ...next, data: { ...next.data, postKey: next.data.postKey ?? crypto.randomUUID() } };
    setEdited(withKey); setError(false);
    try {
      if (!previewState) localStorage.setItem(DRAFT_STORAGE_KEY, encodeWizardDraft(withKey, ownerId));
      setSaved(true); return withKey;
    } catch { setSaved(false); setError(true); return null; }
  }

  async function advance(exit = false) {
    if (pending.current) return;
    if (!exit) {
      const invalid = describeErrors(draft); setFields(invalid);
      if (Object.keys(invalid).length) {
        if (invalid.description) descriptionRef.current?.focus();
        else document.querySelector<HTMLInputElement>("input[name=job-type]")?.focus();
        return;
      }
    }
    pending.current = true; setBusy(true);
    try {
      if (photos.active) {
        await photos.manager.waitForRestore();
        if (exit) await photos.manager.prepareExit();
        else if (step === 1) {
          const state = photos.manager.getSnapshot();
          if (state.photos.some(photo => photo.status !== "done") || offline) return;
          await photos.manager.flush();
        }
      }
      const kept = keep({ ...effectiveDraft, data: { ...effectiveDraft.data, ...(photos.active ? { photoPaths: photos.manager.paths() } : {}) } });
      if (!kept || offline && !exit) return;
      if (ownerId && !offline) {
        const result = await save(canonicalDraft(kept), ownerId);
        if (session?.check(result, { resend: () => advance(exit) })) return;
        if (!("status" in result) || result.status !== "saved") {
          if ("status" in result && result.status === "invalid") setFields(result.fields);
          setError(true); return;
        }
      } else if (previewState === "save-error") { setError(true); return; }
      if (!exit && !keep({ ...kept, completedDescribe: true, completedPhotos: step === 1 ? true : kept.completedPhotos })) return;
      router.push(exit ? "/" : nextHref);
    } catch { setError(true); }
    finally { pending.current = false; setBusy(false); }
  }

  function submit(event: FormEvent) { event.preventDefault(); void advance(); }
  const category = draft.data.category;
  const label = JOB_TYPES.find((item) => item.value === category)?.label;
  const photosSaved = !photos.active || !photos.state.storageError && !photos.state.saving && !photos.state.restoring && photos.state.photos.every(photo => photo.status === "done");
  return <WizardFrame step={step} saved={photosSaved && (saved ?? Boolean(restored || hasServerDraft || previewState === "restored"))} summary={effectiveDraft} photoPreviews={photos.state.photos} backHref={backHref} stepHrefs={stepHrefs} saveExit={() => void advance(true)} busy={busy}>
    <OfflineBanner online={previewState === "offline" ? false : undefined} sticky={false} />
    {restoredNotice && <Banner tone="good" title="Draft restored" className={styles.notice} />}
    {loadFailed && <Banner tone="alert" title="Couldn’t load your draft." className={styles.notice} action={<Button variant="tertiary" onClick={() => router.refresh()}>Try again</Button>} />}
    {error && <Banner tone="alert" title="Couldn’t save." className={styles.notice} live />}
    <h1 ref={headingRef} tabIndex={-1} className={styles.title}>{step === 0 ? "What needs doing?" : step === 1 ? "Add some photos" : "Where & when"}</h1>
    {step === 0 ? <form className={styles.form} onSubmit={submit} noValidate aria-label="Describe the job">
      <div>
        <TextAreaField ref={descriptionRef} label={category === "OTHER" ? "What do you need done?" : "Describe the job"} id="job-description" name="description" value={draft.description} maxLength={1000} rows={5} required
          error={fields.description} readOnly={busy} aria-describedby="description-help" onChange={(event) => { keep(editDescription(draft, event.target.value)); setFields({}); }} />
        <p id="description-help" className={styles.hint}>The more detail, the better your price.</p>
      </div>
      <div>
        <ChipGroup label="Type of job" id="job-type" name="job-type" options={JOB_TYPES} value={category ?? ""} error={fields.category} required disabled={busy}
          onChange={(value) => { keep({ ...draft, data: { ...draft.data, category: value as JobDraft["category"] }, manualCategory: true, completedDescribe: false }); setFields({}); }} />
        <p className={styles.hint}>
          {!draft.manualCategory && label ? <>We guessed {label} from your description. Change it if we’re wrong. </> : null}
          Moving, cleaning, gardening, assembly or anything else? Pick Other.
        </p>
        <Button variant="tertiary" size="sm" className={styles.notSure} disabled={busy} onClick={() => { keep({ ...draft, data: { ...draft.data, category: "OTHER" }, manualCategory: true, completedDescribe: false }); setFields({}); }}>Not sure</Button>
      </div>
      <div className={styles.actions}><Button type="submit" loading={busy || previewState === "saving"} disabled={offline} width="full-on-phone">Next</Button></div>
    </form> : step === 1 ? <DraftPhotos state={photos.state} controls={photos.manager} category={category} offline={offline} busy={busy} onNext={() => void advance()} backHref={backHref} /> : <div className={styles.actions}><Button href={backHref} variant="secondary" width="auto">Back</Button></div>}
  </WizardFrame>;
}

export function PostJobLoading() {
  return <WizardFrame><h1 className={styles.title}>What needs doing?</h1><div role="status" aria-label="Loading draft" className={styles.form}>
    <Skeleton height={24} width="45%" /><Skeleton height={140} /><Skeleton height={24} width="35%" /><Skeleton height={44} /><Skeleton height={55} width="30%" />
  </div></WizardFrame>;
}
