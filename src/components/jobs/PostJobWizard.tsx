"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Wordmark } from "@/components/Wordmark";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { CustomerSignup } from "@/components/auth/CustomerSignup";
import { Dialog } from "@/components/overlays/Dialog";
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
import { applyLandingHandoff, canClearStaleDescribe, canonicalDraft, decodeWizardDraft, describeErrors, editDescription, encodeWizardDraft, inheritUneditedWhere, initialWizardDraft, landingLocationHint, landingWizardDraft, localEnvelopeMatchesInput, recoverServerWizard, reconcileStepSave, reconcileWizardPhotos, serverRepresentsInput, serverRepresentsWhere, whereErrors, JOB_TYPES, WIZARD_STEPS, type WizardDraft } from "@/lib/post-job-wizard";
import { loadDraftPhotosAction, type saveDraftAction } from "@/server/jobs/actions";
import { canResumeSavedPhotos } from "@/lib/jobs/draft-photo-path";
import { currentSchedule, postingDateRange } from "@/lib/job-time-windows";
import { waitlistSharePath } from "@/lib/waitlist";
import { signupLink } from "@/lib/auth/signup";
import { checkJobDraftLocationAction } from "@/server/jobs/address-actions";
import { DraftPhotos } from "./DraftPhotos";
import { DraftWhere } from "./DraftWhere";
import { useDraftPhotos } from "./useDraftPhotos";
import { DraftReview } from "./DraftReview";
import { PostingDraft, type PostingReady } from "./PostingDraft";
import { usePostReview } from "./usePostReview";

import styles from "./post-job.module.css";

type Props = {
  ownerId?: string | null;
  initialDraft?: JobDraft;
  initialManualCategory?: boolean | null;
  hasServerDraft?: boolean;
  loadFailed?: boolean;
  save: typeof saveDraftAction;
  /** Only the guarded component preview passes this. */
  previewState?: string;
  initialNow?: string;
  verified?: boolean;
  initialPosted?: { jobId: string; jobNumber: number };
};
const HANDOFF_PARAMS = ["description", "type"] as const;
const LOCATION_PARAMS = ["location", "lat", "lng"] as const;
const SERVER_DRAFT_PARAM = "savedDraft";
const SERVER_WHERE_PARAM = "savedWhere";
function withoutLandingFallback(href: string) {
  const url = new URL(href, window.location.origin);
  for (const name of [...HANDOFF_PARAMS, ...LOCATION_PARAMS]) url.searchParams.delete(name);
  url.searchParams.delete(SERVER_DRAFT_PARAM);
  url.searchParams.delete(SERVER_WHERE_PARAM);
  return `${url.pathname}${url.search}`;
}
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
      {busy ? <span className={styles.logo}><Wordmark /></span> : <Link href="/" className={styles.logo}><Wordmark /></Link>}
      <div className={styles.navActions}>
        {saved && <span className={styles.saved} role="status">Draft saved <Icon name="cloud_done" size="sm" decorative /></span>}
        <Button variant="secondary" size="sm" width="auto" className={styles.exit} onClick={saveExit} disabled={!saveExit} loading={busy && Boolean(saveExit)}>Save &amp; exit</Button>
      </div>
    </header>
    <div className={styles.wrap}>
      <nav className={styles.rail} aria-label="Post a job">
        <p className={styles.eyebrow}>Post a job</p>
        <ol className={styles.steps}>
          {WIZARD_STEPS.map((label, i) => <li key={label} data-state={i < step ? "done" : i === step ? "now" : "todo"} aria-current={i === step ? "step" : undefined}>
            <span key={i === step ? run : 0} className={`${styles.stepDot} ${i === step && run ? "tm-anim-step-dot" : ""}`} aria-hidden="true">{i < step ? <Icon name="check" size="sm" decorative /> : i + 1}</span>
            {!busy && i < step && (stepHrefs?.[i] ?? backHref) ? <Link href={stepHrefs?.[i] ?? backHref!}>{label}<span className={styles.srOnly}>: Done</span></Link> : <span>{label}<span className={styles.srOnly}>: {i === step ? "Now" : "To do"}</span></span>}
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
        {summary?.data.addressLine1 && <p className={styles.summaryWhere}>{[summary.data.addressLine1, summary.data.suburb].filter(Boolean).join(", ")}{summary.data.asap ? " · ASAP" : summary.data.anyTime ? " · Any time" : ""}</p>}
        <Banner tone="brand" icon="lock" className={styles.summaryTrust}>Free to post. You only pay if you accept the price.</Banner>
      </aside>
    </div>
  </div>;
}

export function PostJobWizard(props: Props) {
  const { ownerId = null, initialDraft = {}, initialManualCategory, hasServerDraft = false, verified = false } = props;
  return <ToastProvider>{props.initialPosted ? <WizardFrame step={3}><h1 className={styles.title}>Posted.</h1><p className={styles.hint}>TM-{props.initialPosted.jobNumber}</p><Button href="/" width="full-on-phone">Home</Button></WizardFrame>
    : props.previewState ? <PostJobWizardForm {...props} />
    : <PostingDraft {...{ ownerId, verified, initialDraft, initialManualCategory, hasServerDraft }}
      fallback={(error, retry) => <WizardFrame step={3}><h1 className={styles.title}>All good?</h1>{error ? <Banner tone="alert" title="Couldn’t load your draft." action={<Button variant="tertiary" onClick={retry}>Try again</Button>} /> : <div role="status" aria-label="Loading draft"><Skeleton height={100} /><Skeleton height={100} /></div>}</WizardFrame>}>
      {source => <PostJobWizardForm {...props} {...source} />}
    </PostingDraft>}</ToastProvider>;
}

function PostJobWizardForm({ ownerId = null, initialDraft = {}, initialManualCategory, hasServerDraft = false, loadFailed = false, save, previewState, initialNow, verified = false, initialLocalDraft, ignoreLocalPostKey, resumeIntent, resumeConflict }: Props & Partial<PostingReady>) {
  const router = useRouter(); const path = usePathname(); const params = useSearchParams();
  const [now, setNow] = useState(() => initialNow ? new Date(initialNow) : new Date());
  const raw = useSyncExternalStore(subscribeDraft, snapshot, () => null);
  const recover = Boolean(ownerId && hasServerDraft && initialDraft.postKey && params.get(SERVER_DRAFT_PARAM) === initialDraft.postKey);
  const confirmedWhereSave = recover && (params.get("step") === "review" || params.get(SERVER_WHERE_PARAM) === initialDraft.postKey);
  const reconcileLocal = (value: WizardDraft | null) => inheritUneditedWhere(reconcileWizardPhotos(value, initialDraft, Boolean(ownerId && hasServerDraft)), initialDraft, Boolean(ownerId && hasServerDraft));
  const cached = decodeWizardDraft(raw, ownerId);
  const local = previewState ? null : reconcileLocal((cached?.data.postKey === ignoreLocalPostKey ? null : cached) ?? initialLocalDraft ?? null);
  const restored = recover ? recoverServerWizard(local, initialDraft, initialManualCategory, confirmedWhereSave, now) : local;
  const [edited, setEdited] = useState<WizardDraft>();
  const queryString = params.toString();
  const handoff = previewState ? {} : landingWizardDraft(Object.fromEntries(params));
  const queryHint = previewState ? undefined : landingLocationHint(Object.fromEntries(params));
  const handoffKey = handoff.description || handoff.category ? JSON.stringify(handoff) : null;
  const appliedHandoff = useRef<string | null>(null); const [consumedHandoff, setConsumedHandoff] = useState<string | null>(null);
  const memory = reconcileLocal(edited ?? null);
  const baseDraft = memory ?? restored ?? initialWizardDraft(initialDraft, hasServerDraft || previewState === "photos", initialManualCategory);
  const describedDraft = handoffKey && handoffKey !== consumedHandoff ? applyLandingHandoff(baseDraft, handoff) : baseDraft;
  const draft = queryHint ? { ...describedDraft, locationHint: queryHint } : describedDraft;
  const serverPaths = ownerId && hasServerDraft && initialDraft.postKey === draft.data.postKey ? initialDraft.photoPaths ?? [] : draft.data.photoPaths ?? [];
  const photoAuthority = Boolean(ownerId && hasServerDraft && initialDraft.postKey === draft.data.postKey);
  const photos = useDraftPhotos({ ownerId, postKey: draft.data.postKey, serverPaths, authoritative: photoAuthority, preview: Boolean(previewState), restoreOrder: resumeConflict ? undefined : resumeIntent?.photoIds });
  const [saved, setSaved] = useState<boolean>();
  const [error, setError] = useState(previewState === "save-error");
  const [fields, setFields] = useState<Record<string, string>>(previewState === "invalid" ? { description: "Describe the job", category: "Type of job" } : {});
  const [saving, setBusy] = useState(previewState === "saving"); const pending = useRef(false);
  useEffect(() => { const timer = setInterval(() => setNow(previous => postingDateRange(previous).today === postingDateRange(new Date()).today ? previous : new Date()), 60_000); return () => clearInterval(timer); }, []);
  const descriptionRef = useRef<HTMLTextAreaElement>(null); const headingRef = useRef<HTMLHeadingElement>(null);
  const session = useOptionalSessionExpired(); const online = useOnlineStatus();
  const offline = !online || previewState === "offline";
  const describeValid = !Object.keys(describeErrors(draft)).length;
  const requestedStep = params.get("step") ?? (previewState === "photos" ? "photos" : "describe");
  const described = draft.completedDescribe && describeValid && Boolean(draft.data.postKey);
  const recoveryPaths = Array.isArray(initialDraft.photoPaths) ? photos.manager.confirmedPaths() : initialDraft.photoPaths;
  const recoveredPhotos = recover && canResumeSavedPhotos(ownerId, draft.data.postKey, recoveryPaths, photos.state);
  const recoveryPending = Boolean(recover && !memory && local && (!serverRepresentsWhere(baseDraft) || !localEnvelopeMatchesInput(baseDraft, local) || local.completedDescribe !== baseDraft.completedDescribe || local.completedWhere !== baseDraft.completedWhere || recoveredPhotos && !local.completedPhotos));
  const whereValid = !Object.keys(whereErrors(draft, now)).length;
  const requestedWhere = ["where", "where-when", "review"].includes(requestedStep);
  const photosComplete = recover ? recoveredPhotos : draft.completedPhotos;
  const step = described && requestedStep === "review" && photosComplete && (recover || draft.completedWhere) && whereValid ? 3 : described && requestedWhere && photosComplete ? 2 : described && (requestedStep === "photos" || requestedWhere) ? 1 : 0;
  const stepHref = (value: string) => { const query = new URLSearchParams(params.toString()); query.set("step", value); return `${path}?${query}`; };
  const stepHrefs = [stepHref("describe"), stepHref("photos"), stepHref("where"), stepHref("review")];
  const backHref = stepHrefs[Math.max(0, step - 1)];
  const nextHref = stepHrefs[Math.min(3, step + 1)];
  const effectiveDraft = { ...draft, data: { ...draft.data, ...(photos.active && !photos.state.restoring ? { photoPaths: photos.manager.paths() } : {}) } };
  const restoredNotice = previewState === "restored" || Boolean(!edited && (restored || hasServerDraft));
  const previousStep = useRef(step);
  useEffect(() => {
    if (previousStep.current !== step) headingRef.current?.focus();
    previousStep.current = step;
  }, [step]);

  const keep = useCallback((next: WizardDraft) => {
    const withKey = { ...next, data: { ...next.data, postKey: next.data.postKey ?? crypto.randomUUID() } };
    setEdited(withKey); setError(false);
    try {
      if (!previewState) localStorage.setItem(DRAFT_STORAGE_KEY, encodeWizardDraft(withKey, ownerId));
      if (!previewState) {
        const clean = withoutLandingFallback(window.location.href);
        if (clean !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", clean);
      }
      setSaved(true); return { draft: withKey, persisted: true };
    } catch { setSaved(false); setError(true); return { draft: withKey, persisted: false }; }
  }, [ownerId, previewState]);

  const posting = usePostReview({ ownerId, verified, draft: effectiveDraft, manager: photos.manager, state: photos.state, save, keep, step, offline, resumeIntent, resumeConflict, preview: Boolean(previewState) });
  const busy = saving || posting.busy || previewState === "posting";

  const consumeHandoff = useEffectEvent((key: string | null, incomingQuery: string) => {
    const query = new URLSearchParams(incomingQuery); const hint = landingLocationHint(Object.fromEntries(query));
    if (!key) { appliedHandoff.current = null; if (consumedHandoff !== null) setConsumedHandoff(null); }
    const describe = Boolean(key && appliedHandoff.current !== key);
    if (!describe && !hint) return;
    // Read the device snapshot here too: useSyncExternalStore hydrates after its empty server snapshot.
    const stored = reconcileLocal(decodeWizardDraft(snapshot(), ownerId));
    let current = memory ?? (recover ? recoverServerWizard(stored, initialDraft, initialManualCategory, confirmedWhereSave, now) : stored) ?? initialWizardDraft(initialDraft, hasServerDraft, initialManualCategory);
    if (ownerId && hasServerDraft && current.data.postKey !== initialDraft.postKey) current = initialWizardDraft(initialDraft, true, initialManualCategory);
    if (ownerId && hasServerDraft) current = { ...current, data: { ...current.data, photoPaths: initialDraft.photoPaths } };
    if (hint) current = { ...current, locationHint: hint };
    if (describe) appliedHandoff.current = key;
    const next = describe ? applyLandingHandoff(current, landingWizardDraft(Object.fromEntries(query))) : current;
    const persisted = keep(next).persisted;
    if (describe) setConsumedHandoff(key);
    const clean = new URLSearchParams(incomingQuery);
    if (describe) clean.delete("step");
    if (persisted) for (const name of HANDOFF_PARAMS) clean.delete(name);
    if (persisted) clean.delete(SERVER_DRAFT_PARAM);
    if (persisted) clean.delete(SERVER_WHERE_PARAM);
    if (hint && persisted) for (const name of LOCATION_PARAMS) clean.delete(name);
    // Next copies its router state itself; forwarding __NA would bypass its search-param update.
    if (clean.toString() !== incomingQuery) window.history.replaceState(null, "", `${path}${clean.size ? `?${clean}` : ""}`);
  });
  // Settle hydration's device snapshot first; a superseded navigation must never consume an old handoff.
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) consumeHandoff(handoffKey, queryString); });
    return () => { active = false; };
  }, [handoffKey, queryString]);

  async function advance(exit = false) {
    if (pending.current) return;
    if (!exit) {
      const invalid = { ...describeErrors(draft), ...(step === 2 ? whereErrors(draft, now) : {}) }; setFields(invalid);
      if (Object.keys(invalid).length) {
        if (invalid.description) descriptionRef.current?.focus();
        else if (invalid.category) document.querySelector<HTMLInputElement>("input[name=job-type]")?.focus();
        else if (invalid.addressLine1 || invalid.locationSource || invalid.point) document.getElementById("job-address")?.focus();
        else if (invalid.suburb || invalid.city || invalid.postcode) document.getElementById(invalid.suburb ? "job-suburb" : invalid.city ? "job-city" : "job-postcode")?.focus();
        else document.querySelector<HTMLInputElement>('input[name="time-windows"]')?.focus();
        return;
      }
    }
    pending.current = true; setBusy(true);
    try {
      const commandKey = draft.data.postKey ?? crypto.randomUUID();
      let photoVersion: { absent: true } | { postKey: string; paths: string[] } | undefined;
      if (!exit && step === 2) {
        const data = canonicalDraft(draft); const location = await checkJobDraftLocationAction({ locationSource: data.locationSource, suburb: data.suburb, point: data.point });
        if (location.status === "outside") { keep(draft); router.push(waitlistSharePath(location.suburb)); return; }
        if (location.status === "invalid") { setFields({ point: "Address" }); document.getElementById("job-address")?.focus(); return; }
        if (location.status !== "inside") { setError(true); return; }
      }
      if (photos.active) {
        await photos.manager.waitForRestore();
        if (exit) await photos.manager.prepareExit();
        else if (step === 1) {
          const state = photos.manager.getSnapshot();
          if (state.photos.some(photo => photo.status !== "done") || offline) return;
          await photos.manager.flush();
        }
      }
      if (ownerId && !offline) {
        const current = await loadDraftPhotosAction(ownerId, commandKey);
        if (session?.check(current, { resend: () => advance(exit) })) return;
        if (!("status" in current) || current.status !== "loaded" && current.status !== "empty") { setError(true); router.refresh(); return; }
        if (current.status === "empty") { if (photos.active) await photos.manager.confirmAbsent(); photoVersion = { absent: true }; }
        else photos.manager.reconcile(current.photoPaths);
        await photos.manager.flush();
        if (current.status === "loaded") photoVersion = { postKey: commandKey, paths: photos.manager.confirmedPaths() };
        if (!exit && step === 1 && photos.manager.getSnapshot().photos.some(photo => photo.status !== "done")) return;
      }
      let kept = keep({ ...effectiveDraft, data: { ...effectiveDraft.data, ...(step === 2 ? currentSchedule(draft.data, now) : {}), postKey: commandKey, ...(photos.active ? { photoPaths: photos.manager.paths() } : {}) } });
      let durable = kept.persisted; let envelopePersisted = kept.persisted; let savedToServer = false;
      if (offline && !exit) return;
      if (ownerId && !offline) {
        const canonical = canonicalDraft(kept.draft);
        const saveStep = (["describe", "photos", "where", "review"] as const)[step];
        const result = await save(canonical, ownerId, photoVersion, kept.draft.manualCategory, saveStep);
        if (session?.check(result, { resend: () => advance(exit) })) return;
        if ("status" in result && result.status === "photos-changed") { photos.manager.reconcile(result.photoPaths, true); await photos.manager.flush(); setError(true); return; }
        if ("status" in result && result.status === "draft-changed") { setError(true); router.refresh(); return; }
        if (!("status" in result) || result.status !== "saved") {
          if ("status" in result && result.status === "invalid") setFields(result.fields);
          setError(true); return;
        }
        const committed = result.draft;
        const reconciled = reconcileStepSave(kept.draft, committed, result.manualCategory, saveStep, now);
        if (JSON.stringify(reconciled) !== JSON.stringify(kept.draft)) {
          kept = keep(reconciled); durable = kept.persisted; envelopePersisted = kept.persisted;
        }
        await photos.manager.confirmSaved(committed.photoPaths ?? []);
        savedToServer = true;
        durable ||= serverRepresentsInput(kept.draft, committed, result.manualCategory)
          && localEnvelopeMatchesInput(kept.draft, inheritUneditedWhere(decodeWizardDraft(snapshot(), ownerId), committed, true));
      } else if (previewState === "save-error") { setError(true); return; }
      if (exit && !durable) { setError(true); return; }
      if (!exit) {
        const completed = keep({ ...kept.draft, completedDescribe: step === 0 ? true : kept.draft.completedDescribe, completedPhotos: step >= 1 ? true : kept.draft.completedPhotos, completedWhere: step === 2 ? true : kept.draft.completedWhere });
        envelopePersisted ||= completed.persisted;
        durable = completed.persisted;
        // Photos may still hold local-only raw files and completion state; use its owned server fallback.
        if (step === 0 && savedToServer && !durable && canClearStaleDescribe(completed.draft, decodeWizardDraft(snapshot(), ownerId))) {
          try { localStorage.removeItem(DRAFT_STORAGE_KEY); durable = localStorage.getItem(DRAFT_STORAGE_KEY) === null; } catch { /* Keep memory and use the key-bound server fallback below. */ }
        }
      }
      if (durable) { setSaved(true); setError(false); }
      const destination = new URL(envelopePersisted || durable ? withoutLandingFallback(nextHref) : nextHref, window.location.origin);
      if (!exit && savedToServer) for (const name of HANDOFF_PARAMS) destination.searchParams.delete(name);
      // Unfinished raw Where must not retain an earlier confirmed-Where recovery context.
      if (!exit && savedToServer && !serverRepresentsWhere(kept.draft)) destination.searchParams.delete(SERVER_WHERE_PARAM);
      if (!exit && savedToServer && !durable) destination.searchParams.set(SERVER_DRAFT_PARAM, kept.draft.data.postKey!);
      if (!exit && savedToServer && !durable && step === 2) destination.searchParams.set(SERVER_WHERE_PARAM, kept.draft.data.postKey!);
      router.push(exit ? "/" : `${destination.pathname}${destination.search}`);
    } catch { setError(true); }
    finally { pending.current = false; setBusy(false); }
  }

  function submit(event: FormEvent) { event.preventDefault(); void advance(); }
  const category = draft.data.category;
  const label = JOB_TYPES.find((item) => item.value === category)?.label;
  const photosSaved = !photos.active || !photos.state.storageError && !photos.state.saving && !photos.state.restoring && photos.state.photos.every(photo => photo.status === "done");
  return <><WizardFrame step={step} saved={photosSaved && !recoveryPending && !posting.busy && (saved ?? Boolean(restored || hasServerDraft || previewState === "restored"))} summary={effectiveDraft} photoPreviews={photos.state.photos} backHref={backHref} stepHrefs={stepHrefs} saveExit={posting.busy ? undefined : () => void advance(true)} busy={busy}>
    <OfflineBanner online={previewState === "offline" ? false : undefined} sticky={false} />
    {restoredNotice && <Banner tone="good" title="Draft restored" className={styles.notice} />}
    {loadFailed && <Banner tone="alert" title="Couldn’t load your draft." className={styles.notice} action={<Button variant="tertiary" onClick={() => router.refresh()}>Try again</Button>} />}
    {(error || recoveryPending) && <Banner tone="alert" title="Couldn’t save." className={styles.notice} live />}
    {posting.detail && <Banner tone="alert" className={styles.notice}>{posting.detail}</Banner>}
    <h1 ref={headingRef} tabIndex={-1} className={styles.title}>{step === 0 ? "What needs doing?" : step === 1 ? "Add some photos" : step === 2 ? "Where and when?" : "All good?"}</h1>
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
    </form> : step === 1 ? <DraftPhotos state={photos.state} controls={photos.manager} category={category} offline={offline} busy={busy} onNext={() => void advance()} backHref={backHref} /> : step === 2 ? <DraftWhere draft={draft} now={now} fields={fields} busy={busy} offline={offline} backHref={backHref} onNext={() => void advance()}
      onChange={next => { keep(next); setFields({}); }} onOutside={(next, suggestion) => { keep(next); router.push(waitlistSharePath(suggestion.suburb)); }} /> : <DraftReview draft={effectiveDraft} photos={photos.state} editHrefs={stepHrefs} backHref={backHref} busy={busy} offline={offline} error={posting.error || previewState === "post-error"} onPost={posting.post} onEdit={posting.cancel} />}
  </WizardFrame><Dialog open={posting.signup || previewState === "signup"} onClose={posting.cancel} title="Create account" size="md" footer={<Link href={signupLink("/login", posting.returnPath)}>Log in instead</Link>}>
    <CustomerSignup embedded next={posting.returnPath} />
  </Dialog></>;
}

export function PostJobLoading() {
  return <WizardFrame><h1 className={styles.title}>What needs doing?</h1><div role="status" aria-label="Loading draft" className={styles.form}>
    <Skeleton height={24} width="45%" /><Skeleton height={140} /><Skeleton height={24} width="35%" /><Skeleton height={44} /><Skeleton height={55} width="30%" />
  </div></WizardFrame>;
}
