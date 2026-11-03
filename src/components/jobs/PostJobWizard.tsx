"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Wordmark } from "@/components/Wordmark";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { OfflineBanner, useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { Skeleton } from "@/components/feedback/Skeleton";
import { ChipGroup } from "@/components/forms/ChoiceFields";
import { TextAreaField } from "@/components/forms/TextFields";
import { Banner } from "@/components/overlays/Banner";
import { DRAFT_STORAGE_KEY, type JobDraft } from "@/lib/job-draft";
import { wentUp } from "@/lib/motion/helpers";
import { useBump } from "@/lib/motion/hooks";
import { applyLandingHandoff, canonicalDraft, decodeWizardDraft, describeErrors, editDescription, encodeWizardDraft, initialWizardDraft, landingLocationHint, landingWizardDraft, localEnvelopeMatchesInput, JOB_TYPES, WIZARD_STEPS, type WizardDraft } from "@/lib/post-job-wizard";
import type { saveDraftAction } from "@/server/jobs/actions";

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
const HANDOFF_PARAMS = ["description", "type"] as const;
const LOCATION_PARAMS = ["location", "lat", "lng"] as const;
function subscribeDraft(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
function snapshot() { try { return localStorage.getItem(DRAFT_STORAGE_KEY); } catch { return null; } }

export function WizardFrame({ step = 0, saved, saveExit, children, summary, backHref, busy }: {
  step?: number; saved?: boolean; saveExit?: () => void; children: ReactNode; summary?: WizardDraft; backHref?: string; busy?: boolean;
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
            {i < step && backHref ? <Link href={backHref}>{label}<span className={styles.srOnly}>: Done</span></Link> : <span>{label}<span className={styles.srOnly}>: {i === step ? "Now" : "To do"}</span></span>}
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
        {summary?.data.category && <span className={styles.category}>{JOB_TYPES.find((item) => item.value === summary.data.category)?.label}</span>}
        {summary?.description && <p className={styles.summaryText}>{summary.description}</p>}
        <Banner tone="brand" icon="lock">Free to post. You only pay if you accept the price.</Banner>
      </aside>
    </div>
  </div>;
}

export function PostJobWizard({ ownerId = null, initialDraft = {}, hasServerDraft = false, loadFailed = false, save, previewState }: Props) {
  const router = useRouter(); const path = usePathname(); const params = useSearchParams();
  const raw = useSyncExternalStore(subscribeDraft, snapshot, () => null);
  const restored = previewState ? null : decodeWizardDraft(raw, ownerId);
  const [edited, setEdited] = useState<WizardDraft>();
  const queryString = params.toString();
  const handoff = previewState ? {} : landingWizardDraft(Object.fromEntries(params));
  const queryHint = previewState ? undefined : landingLocationHint(Object.fromEntries(params));
  const handoffKey = handoff.description || handoff.category ? JSON.stringify(handoff) : null;
  const appliedHandoff = useRef<string | null>(null); const [consumedHandoff, setConsumedHandoff] = useState<string | null>(null);
  const baseDraft = edited ?? restored ?? initialWizardDraft(initialDraft, hasServerDraft || previewState === "photos");
  const describedDraft = handoffKey && handoffKey !== consumedHandoff ? applyLandingHandoff(baseDraft, handoff) : baseDraft;
  const draft = queryHint ? { ...describedDraft, locationHint: queryHint } : describedDraft;
  const [saved, setSaved] = useState<boolean>();
  const [error, setError] = useState(previewState === "save-error");
  const [fields, setFields] = useState<Record<string, string>>(previewState === "invalid" ? { description: "Describe the job", category: "Type of job" } : {});
  const [busy, setBusy] = useState(previewState === "saving"); const pending = useRef(false);
  const descriptionRef = useRef<HTMLTextAreaElement>(null); const headingRef = useRef<HTMLHeadingElement>(null);
  const session = useOptionalSessionExpired(); const online = useOnlineStatus();
  const offline = !online || previewState === "offline";
  const describeValid = !Object.keys(describeErrors(draft)).length;
  const step = (params.get("step") === "photos" || (!params.has("step") && previewState === "photos")) && draft.completedDescribe && describeValid ? 1 : 0;
  const query = new URLSearchParams(params.toString()); query.delete("step");
  for (const name of HANDOFF_PARAMS) query.delete(name);
  if (previewState === "photos") query.set("step", "describe");
  const backHref = `${path}${query.size ? `?${query}` : ""}`;
  const nextQuery = new URLSearchParams(query); nextQuery.set("step", "photos");
  const nextHref = `${path}?${nextQuery}`;
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
      setSaved(true); return { draft: withKey, persisted: true };
    } catch { setSaved(false); setError(true); return { draft: withKey, persisted: false }; }
  }, [ownerId, previewState]);

  const consumeHandoff = useEffectEvent((key: string | null, incomingQuery: string) => {
    const query = new URLSearchParams(incomingQuery); const hint = landingLocationHint(Object.fromEntries(query));
    if (!key) { appliedHandoff.current = null; if (consumedHandoff !== null) setConsumedHandoff(null); }
    const describe = Boolean(key && appliedHandoff.current !== key);
    if (!describe && !hint) return;
    // Read the device snapshot here too: useSyncExternalStore hydrates after its empty server snapshot.
    let current = edited ?? decodeWizardDraft(snapshot(), ownerId) ?? initialWizardDraft(initialDraft, hasServerDraft);
    if (ownerId && hasServerDraft && current.data.postKey !== initialDraft.postKey) current = initialWizardDraft(initialDraft, true);
    if (ownerId && hasServerDraft) current = { ...current, data: { ...current.data, photoPaths: initialDraft.photoPaths } };
    if (hint) current = { ...current, locationHint: hint };
    if (describe) appliedHandoff.current = key;
    const next = describe ? applyLandingHandoff(current, landingWizardDraft(Object.fromEntries(query))) : current;
    const persisted = keep(next).persisted;
    if (describe) setConsumedHandoff(key);
    const clean = new URLSearchParams(incomingQuery);
    if (describe) for (const name of [...HANDOFF_PARAMS, "step"]) clean.delete(name);
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
      const invalid = describeErrors(draft); setFields(invalid);
      if (Object.keys(invalid).length) {
        if (invalid.description) descriptionRef.current?.focus();
        else document.querySelector<HTMLInputElement>("input[name=job-type]")?.focus();
        return;
      }
    }
    const kept = keep(draft); let durable = kept.persisted;
    if (offline && !exit) return;
    if (ownerId && !offline) {
      pending.current = true; setBusy(true);
      try {
        const canonical = canonicalDraft(kept.draft);
        const result = await save(canonical, ownerId);
        if (session?.check(result, { resend: () => advance(exit) })) return;
        if (!("status" in result) || result.status !== "saved") {
          if ("status" in result && result.status === "invalid") setFields(result.fields);
          setError(true); return;
        }
        // Unfinished text that the shared schema omits still needs local persistence before leaving.
        durable ||= typeof canonical.description === "string" && canonical.description === kept.draft.description.trim() && localEnvelopeMatchesInput(kept.draft, decodeWizardDraft(snapshot(), ownerId));
      } catch { setError(true); return; }
      finally { pending.current = false; setBusy(false); }
    } else if (previewState === "save-error") { setError(true); return; }
    // Only a successful Next completes Describe. Merely typing valid fields into a Photos URL never does.
    if (exit && !durable) { setError(true); return; }
    if (!exit) keep({ ...kept.draft, completedDescribe: true });
    if (durable) { setSaved(true); setError(false); }
    router.push(exit ? "/" : nextHref);
  }

  function submit(event: FormEvent) { event.preventDefault(); void advance(); }
  const category = draft.data.category;
  const label = JOB_TYPES.find((item) => item.value === category)?.label;
  return <WizardFrame step={step} saved={saved ?? Boolean(restored || hasServerDraft || previewState === "restored")} summary={draft} backHref={backHref} saveExit={() => void advance(true)} busy={busy}>
    <OfflineBanner online={previewState === "offline" ? false : undefined} sticky={false} />
    {restoredNotice && <Banner tone="good" title="Draft restored" className={styles.notice} />}
    {loadFailed && <Banner tone="alert" title="Couldn’t load your draft." className={styles.notice} action={<Button variant="tertiary" onClick={() => router.refresh()}>Try again</Button>} />}
    {error && <Banner tone="alert" title="Couldn’t save." className={styles.notice} live />}
    <h1 ref={headingRef} tabIndex={-1} className={styles.title}>{step === 0 ? "What needs doing?" : "Photos"}</h1>
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
    </form> : <div className={styles.actions}><Button href={backHref} variant="secondary" width="auto">Back</Button></div>}
  </WizardFrame>;
}

export function PostJobLoading() {
  return <WizardFrame><h1 className={styles.title}>What needs doing?</h1><div role="status" aria-label="Loading draft" className={styles.form}>
    <Skeleton height={24} width="45%" /><Skeleton height={140} /><Skeleton height={24} width="35%" /><Skeleton height={44} /><Skeleton height={55} width="30%" />
  </div></WizardFrame>;
}
