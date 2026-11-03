"use client";

import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { signupLink } from "@/lib/auth/signup";
import { verificationPath } from "@/lib/auth/verification";
import { DRAFT_STORAGE_KEY, postJobSchema, type JobDraft } from "@/lib/job-draft";
import { currentSchedule } from "@/lib/job-time-windows";
import { initializeOwnedPhotoDraft, loadPhotoDraft } from "@/lib/jobs/draft-photo-browser";
import { abandonPostIntent, bindPostIntent, clearPostedLocalDraft, decodePostIntent, POST_INTENT_PARAM, POST_INTENT_STORAGE_KEY, postIntentDraft, writePostIntent, type PostIntent } from "@/lib/jobs/post-intent";
import { canonicalDraft, decodeWizardDraft, encodeWizardDraft, reconcileStepSave, type WizardDraft } from "@/lib/post-job-wizard";
import { saveDraftAction } from "@/server/jobs/actions";
import { inspectPostKeyAction } from "@/server/jobs/posting-actions";
import { Button } from "@/components/Button";
import { Banner } from "@/components/overlays/Banner";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import styles from "./post-job.module.css";

export type PostingSource = { initialDraft: JobDraft; hasServerDraft: boolean; initialManualCategory?: boolean | null };
export type PostingReady = PostingSource & { initialLocalDraft?: WizardDraft; ignoreLocalPostKey?: string; resumeIntent?: PostIntent; resumeConflict?: boolean };
type Props = PostingSource & {
  ownerId: string | null; verified: boolean; children(source: PostingReady): ReactNode;
  fallback(error: boolean, retry: () => void, leave: () => void, conflict: boolean): ReactNode;
};
type ReadyState = { mode: "normal" } | { mode: "fresh"; ignored: string; source: PostingSource }
  | { mode: "handoff"; source: PostingSource; local: WizardDraft; intent: PostIntent; conflict: boolean };

function comparable(data: JobDraft, now: Date) {
  const parsed = postJobSchema.safeParse({ ...data, photoPaths: [], ...currentSchedule(data, now) });
  return parsed.success ? JSON.stringify(parsed.data) : null;
}
function safeRead(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
class SavedDraftConflict extends Error {}
export function PostingEntryError({ retry, leave, conflict }: { retry(): void; leave(): void; conflict: boolean }) {
  return <div className={styles.entryRecovery}><Banner tone="alert" title={conflict ? "You already have a saved draft." : "Couldn’t load your draft."} action={<Button variant="tertiary" onClick={retry}>Try again</Button>} /><Button variant="secondary" onClick={leave}>{conflict ? "Use my saved draft" : "Back to my draft"}</Button></div>;
}

/** Entry-only preparation. It finishes an explicit guest claim before mounting any account photo controller. */
export function PostingDraft({ ownerId, verified, initialDraft, hasServerDraft, initialManualCategory, children, fallback }: Props) {
  const router = useRouter(); const path = usePathname(); const params = useSearchParams();
  const session = useOptionalSessionExpired();
  const [ready, setReady] = useState<ReadyState | null>(null); const [error, setError] = useState(false); const [conflict, setConflict] = useState(false); const [attempt, setAttempt] = useState(0);
  const sequence = useRef(0); const [entered, setEntered] = useState<string[]>([]);
  async function initialize(isActive: () => boolean) {
    const request = ++sequence.current; setError(false); setConflict(false); setEntered([]);
    const current = () => isActive() && request === sequence.current;
    const interrupted = (result: unknown) => !current() || Boolean(session?.check(result, { resend: () => setAttempt(value => value + 1) }));
    const finish = (value: ReadyState) => { if (current()) setReady(value); };
    try {
      const rawIntent = safeRead(POST_INTENT_STORAGE_KEY);
      const stored = decodePostIntent(rawIntent);
      const intent = stored && params.get(POST_INTENT_PARAM) === stored.postKey ? stored : null;
      if (intent) {
        if (rawIntent !== null) setEntered([rawIntent]);
        const query = new URLSearchParams({ step: "review", [POST_INTENT_PARAM]: intent.postKey });
        const next = `${path}?${query}`;
        if (!ownerId) { router.replace(signupLink("/login", next)); return; }
        if (!verified) { router.replace(verificationPath(next)); return; }
        const bound = bindPostIntent(intent, ownerId);
        if (!bound) throw new Error("Different account");
        const status = await inspectPostKeyAction(ownerId, intent.postKey, false, true);
        if (interrupted(status)) return;
        if (!("status" in status)) throw new Error("Session changed");
        if (status.status === "unverified") { router.replace(verificationPath(next)); return; }
        if (status.status === "posted") { router.replace(`/jobs/${status.jobId}?posted=1`); return; }
        if (status.status !== "unposted") throw new Error("Draft status unavailable");
        if (hasServerDraft && initialDraft.postKey !== intent.postKey) throw new SavedDraftConflict();
        setEntered(values => [...new Set([...values, JSON.stringify(bound)])]);
        if (!writePostIntent(localStorage, bound)) throw new Error("Intent could not be kept");
        // This atomic claim also binds competing tabs to one owner. [] is an existing intentional selection.
        if (bound.sourceOwnerId === null) {
          const claim = await initializeOwnedPhotoDraft(ownerId, bound.postKey, bound.photoIds);
          if (!current()) return;
          if (claim !== "initialized" && claim !== "existing") throw new Error("Guest photos changed");
        }
        const source = postIntentDraft(bound); let committed = initialDraft; let origin = initialManualCategory ?? null;
        if (!hasServerDraft) {
          const result = await saveDraftAction({ ...canonicalDraft(source), photoPaths: [] }, ownerId, { absent: true }, source.manualCategory, "review");
          if (interrupted(result)) return;
          if (!("status" in result) || result.status !== "saved") throw new Error("Draft changed before handoff");
          committed = result.draft; origin = result.manualCategory;
        }
        // Compare the complete selection, including unuploaded originals. The live manager separately
        // checks authoritative attachments/removals before automatic posting.
        const files = await loadPhotoDraft({ ownerId, postKey: bound.postKey });
        if (!current()) return;
        const now = new Date(); const conflict = comparable(canonicalDraft(source), now) !== comparable(committed, now)
          || JSON.stringify((files ?? []).map(photo => photo.id)) !== JSON.stringify(bound.photoIds);
        const local = reconcileStepSave(source, committed, origin, "review", now);
        try {
          const raw = safeRead(DRAFT_STORAGE_KEY);
          const guest = decodeWizardDraft(raw, null); const owned = decodeWizardDraft(raw, ownerId);
          if (raw === null || guest?.data.postKey === bound.postKey || owned?.data.postKey === bound.postKey) localStorage.setItem(DRAFT_STORAGE_KEY, encodeWizardDraft(local, ownerId));
        } catch { /* The committed owned draft and original intent/files remain available. */ }
        finish({ mode: "handoff", source: { initialDraft: committed, hasServerDraft: true, initialManualCategory: origin }, local, intent: bound, conflict });
        return;
      }
      if (ownerId) {
        const cached = decodeWizardDraft(safeRead(DRAFT_STORAGE_KEY), ownerId);
        const key = initialDraft.postKey ?? cached?.data.postKey;
        if (key) {
          const status = await inspectPostKeyAction(ownerId, key);
          if (interrupted(status)) return;
          if (!("status" in status) || status.status === "unknown") throw new Error("Draft status unavailable");
          if (status.status === "posted") {
            const fresh = await inspectPostKeyAction(ownerId, key, true);
            if (interrupted(fresh)) return;
            if (!("status" in fresh) || fresh.status !== "fresh") throw new Error("Draft cleanup unavailable");
            clearPostedLocalDraft(localStorage, ownerId, key);
            finish({ mode: "fresh", ignored: key, source: fresh }); return;
          }
        }
      }
      finish({ mode: "normal" });
    } catch (failure) { if (isActive() && request === sequence.current) { setReady(null); setError(true); setConflict(failure instanceof SavedDraftConflict); } }
  }
  const enter = useEffectEvent(initialize);
  // Step navigation and same-owner RSC refreshes keep the live controller; only a new entry/account initializes it.
  useEffect(() => {
    let active = true; queueMicrotask(() => { if (active) void enter(() => active); });
    return () => { active = false; };
  }, [ownerId, attempt]);
  const retry = () => setAttempt(value => value + 1);
  const leave = () => {
    try { abandonPostIntent(localStorage, entered); } catch { /* Access to storage itself may be blocked. */ }
    // A full, clean entry discards no draft/files and cannot resume the abandoned gesture, even if storage failed.
    window.location.assign(path);
  };
  if (!ownerId && !params.has(POST_INTENT_PARAM)) return children({ initialDraft, hasServerDraft, initialManualCategory });
  if (!ready) return fallback(error, retry, leave, conflict);
  if (ready.mode === "normal") return children({ initialDraft, hasServerDraft, initialManualCategory });
  if (ready.mode === "fresh") {
    const live = hasServerDraft && initialDraft.postKey !== ready.ignored ? { initialDraft, hasServerDraft, initialManualCategory } : ready.source;
    return children({ ...live, ignoreLocalPostKey: ready.ignored });
  }
  if (hasServerDraft && initialDraft.postKey !== ready.intent.postKey) return fallback(true, retry, leave, true);
  const live = hasServerDraft ? { initialDraft, hasServerDraft, initialManualCategory } : ready.source;
  return children({ ...live, initialLocalDraft: ready.local, resumeIntent: ready.intent, resumeConflict: ready.conflict });
}
