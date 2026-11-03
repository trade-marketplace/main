"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { postJobSchema } from "@/lib/job-draft";
import { currentSchedule } from "@/lib/job-time-windows";
import { verificationPath } from "@/lib/auth/verification";
import { clearPhotoDraft, guestPhotoClaim, releasePhotoClaim } from "@/lib/jobs/draft-photo-browser";
import type { DraftPhotoManager, PhotoSnapshot } from "@/lib/jobs/draft-photo-manager";
import { clearPostIntent, clearPostedLocalDraft, createPostIntent, matchesPostIntent, POST_INTENT_PARAM, writePostIntent, type PostIntent } from "@/lib/jobs/post-intent";
import { canonicalDraft, reconcileStepSave, type WizardDraft } from "@/lib/post-job-wizard";
import { tryAgainText } from "@/lib/rate-limit";
import { waitlistSharePath } from "@/lib/waitlist";
import { loadDraftPhotosAction, postJobAction, type saveDraftAction } from "@/server/jobs/actions";
import { inspectPostKeyAction } from "@/server/jobs/posting-actions";

export function reviewedSnapshot(draft: WizardDraft, paths: string[], now: Date) {
  return postJobSchema.safeParse({ ...canonicalDraft(draft), ...currentSchedule(draft.data, now), photoPaths: paths });
}
export function photosReady(state: PhotoSnapshot) {
  return !state.restoring && !state.saving && !state.storageError && state.photos.length <= 6
    && state.photos.every(photo => photo.status === "done" && !photo.needsRetry && !photo.pendingAttach);
}

export function usePostReview({ ownerId, verified, draft, manager, state, save, keep, step, offline, resumeIntent, resumeConflict, preview }: {
  ownerId: string | null; verified: boolean; draft: WizardDraft; manager: DraftPhotoManager; state: PhotoSnapshot;
  save: typeof saveDraftAction; keep(next: WizardDraft): unknown; step: number; offline: boolean;
  resumeIntent?: PostIntent; resumeConflict?: boolean; preview?: boolean;
}) {
  const router = useRouter(); const path = usePathname(); const params = useSearchParams();
  const session = useOptionalSessionExpired();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(false); const [detail, setDetail] = useState<string>();
  const [signup, setSignup] = useState(false); const pending = useRef(false); const attempted = useRef<string | null>(null);
  const returnPath = `${path}?${new URLSearchParams({ step: "review", [POST_INTENT_PARAM]: draft.data.postKey ?? "" })}`;
  function cancel() {
    setSignup(false);
    if (draft.data.postKey) clearPostIntent(localStorage, ownerId, draft.data.postKey);
    const query = new URLSearchParams(window.location.search); query.delete(POST_INTENT_PARAM);
    window.history.replaceState(null, "", `${path}${query.size ? `?${query}` : ""}`);
  }
  async function finishPosted(jobId: string, postKey: string, selectedIds: string[]) {
    if (!ownerId) return;
    // Device cleanup never affects a different draft or another account. Originals survive ambiguous responses.
    try {
      const guestIds = await guestPhotoClaim(ownerId, postKey);
      const ownedMetadata = clearPostedLocalDraft(localStorage, ownerId, postKey);
      const guestMetadata = !guestIds || clearPostedLocalDraft(localStorage, null, postKey);
      const intentCleared = clearPostIntent(localStorage, ownerId, postKey);
      const ownedFiles = await clearPhotoDraft({ ownerId, postKey }, selectedIds);
      const guestFiles = !guestIds || await clearPhotoDraft({ ownerId: null, postKey }, guestIds);
      if (ownedMetadata && guestMetadata && intentCleared && ownedFiles && guestFiles) await releasePhotoClaim(ownerId, postKey);
    } catch { /* An owned consumed-key probe prevents reuse when device cleanup is blocked. */ }
    router.replace(`${path}?posted=${jobId}`);
  }
  async function post(automatic = false) {
    if (pending.current || offline || !photosReady(manager.getSnapshot())) return;
    const selectedIds = manager.getSnapshot().photos.map(photo => photo.id);
    if (automatic && (resumeConflict || !resumeIntent || !matchesPostIntent(draft, resumeIntent, new Date()) || JSON.stringify(selectedIds) !== JSON.stringify(resumeIntent.photoIds))) { setError(true); return; }
    const reviewed = reviewedSnapshot(draft, manager.paths(), new Date());
    if (!reviewed.success || !draft.data.postKey) { setError(true); return; }
    if (preview) { setError(true); return; }
    pending.current = true; setBusy(true); setError(false); setDetail(undefined);
    try {
      await manager.waitForRestore(); await manager.flush();
      if (!photosReady(manager.getSnapshot()) || JSON.stringify(selectedIds) !== JSON.stringify(manager.getSnapshot().photos.map(photo => photo.id))) throw new Error("Photos changed");
      const entered = { ...draft, data: { ...draft.data, ...reviewed.data } };
      keep(entered);
      if (!ownerId || !verified) {
        const intent = createPostIntent(entered, ownerId, selectedIds);
        if (!writePostIntent(localStorage, intent)) throw new Error("Intent unavailable");
        if (!ownerId) setSignup(true);
        else router.push(verificationPath(returnPath));
        return;
      }
      const status = await inspectPostKeyAction(ownerId, draft.data.postKey, false, true);
      if (session?.check(status, { resend: () => post(automatic) })) return;
      if (!("status" in status)) throw new Error("Session changed");
      if (status.status === "unverified") {
        if (!writePostIntent(localStorage, createPostIntent(entered, ownerId, selectedIds))) throw new Error("Intent unavailable");
        router.push(verificationPath(returnPath)); return;
      }
      if (status.status === "posted") { await finishPosted(status.jobId, draft.data.postKey, selectedIds); return; }
      if (status.status !== "unposted") throw new Error("Draft status unavailable");
      const current = await loadDraftPhotosAction(ownerId, draft.data.postKey);
      if (session?.check(current, { resend: () => post(automatic) })) return;
      if (!("status" in current) || current.status !== "loaded") throw new Error("Draft changed");
      if (JSON.stringify(current.photoPaths) !== JSON.stringify(reviewed.data.photoPaths)) {
        manager.reconcile(current.photoPaths, true); await manager.flush(); throw new Error("Photos changed");
      }
      const result = await save(reviewed.data, ownerId, { postKey: draft.data.postKey, paths: current.photoPaths }, draft.manualCategory, "review");
      if (session?.check(result, { resend: () => post(automatic) })) return;
      if (!("status" in result) || result.status !== "saved") {
        if ("status" in result && result.status === "photos-changed") manager.reconcile(result.photoPaths, true);
        throw new Error("Draft changed");
      }
      const reconciled = reconcileStepSave(entered, result.draft, result.manualCategory, "review", new Date());
      keep(reconciled);
      const committed = reviewedSnapshot(reconciled, result.draft.photoPaths ?? [], new Date());
      if (!committed.success || JSON.stringify(committed.data) !== JSON.stringify(reviewed.data)) throw new Error("Review changed");
      const posted = await postJobAction(reviewed.data, draft.data.postKey, ownerId, { postKey: draft.data.postKey, paths: current.photoPaths });
      if (posted.status === "outside-area") { router.push(waitlistSharePath(posted.waitlist.suburb)); return; }
      if (posted.status === "needs-account") {
        if (!writePostIntent(localStorage, createPostIntent(entered, ownerId, selectedIds))) throw new Error("Intent unavailable");
        router.push(verificationPath(returnPath)); return;
      }
      if (posted.status === "rate-limited") setDetail(tryAgainText(posted.retryAfter));
      if (posted.status !== "posted") { setError(true); if (posted.status === "draft-changed") router.refresh(); return; }
      await finishPosted(posted.jobId, draft.data.postKey, selectedIds);
    } catch { setError(true); }
    finally { pending.current = false; setBusy(false); }
  }
  const resume = useEffectEvent(() => {
    if (!resumeIntent || !ownerId || !verified || step !== 3 || !photosReady(state) || params.get(POST_INTENT_PARAM) !== resumeIntent.postKey || attempted.current === resumeIntent.postKey) return;
    attempted.current = resumeIntent.postKey;
    void post(true);
  });
  useEffect(() => { if (!preview) queueMicrotask(() => resume()); }, [step, state, resumeIntent, ownerId, verified, preview]);
  return { busy, error, detail, signup, returnPath, post: () => void post(), cancel };
}
