"use client";
// Price expiry (#508): the closed job says why it closed and offers Post again, which starts Post a job with the
// same words, trade and address. A job draft the customer already has is only replaced when they say so.
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/Button";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { Banner } from "@/components/overlays/Banner";
import type { AuthFailure } from "@/lib/auth/results";
import { DRAFT_STORAGE_KEY } from "@/lib/job-draft";
import type { PostAgainResult } from "@/server/jobs/post-again";
import { postAgainAction } from "@/server/jobs/post-again-actions";
import styles from "./post-again.module.css";

export type PostAgainAction = (jobId: string, replace: boolean) => Promise<PostAgainResult | AuthFailure>;
/** Visual states for the guarded component catalogue only. */
export type PostAgainPreview = "ready" | "draft-exists" | "saving" | "error";

export const POST_AGAIN_WORDS = {
  why: "Your price closed after 7 days with no answer. Saying no was free.",
  button: "Post again",
  hint: "We’ll fill in what you wrote. Add photos and times again.",
  draftExists: "You’ve got a job started in Post a job. Post again will replace it.",
  replace: "Replace it",
  keep: "Keep my draft",
  error: "Couldn’t start it. Try again.",
} as const;

function localDraftExists(): boolean {
  try { return Boolean(localStorage.getItem(DRAFT_STORAGE_KEY)); } catch { return false; }
}
function clearLocalDraft() {
  try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* The wizard then reconciles with the saved draft. */ }
}

export function PostAgain({ jobId, online, preview, action = postAgainAction }: { jobId: string; online: boolean; preview?: PostAgainPreview; action?: PostAgainAction }) {
  const router = useRouter(), session = useOptionalSessionExpired(), pending = useRef(false);
  const [state, setState] = useState<"idle" | "saving" | "draft-exists" | "error">(preview === "draft-exists" || preview === "saving" || preview === "error" ? preview : "idle");
  async function start(replace: boolean) {
    if (pending.current || preview) return;
    // A draft only in this browser counts too: never wipe what they typed without asking.
    if (!replace && localDraftExists()) { setState("draft-exists"); return; }
    pending.current = true; setState("saving");
    try {
      const result = await action(jobId, replace);
      if (session?.check(result)) { setState("idle"); return; }
      if ("status" in result && result.status === "ready") { clearLocalDraft(); router.push("/jobs/new"); return; }
      setState("status" in result && result.status === "draft-exists" ? "draft-exists" : "error");
    } catch { setState("error"); }
    finally { pending.current = false; }
  }
  const saving = state === "saving", offline = !online ? "You’re offline" : undefined;
  return <div className={styles.panel}>
    <p className={styles.why}>{POST_AGAIN_WORDS.why}</p>
    {state === "draft-exists" ? <Banner tone="info" live>
      <p className={styles.bannerText}>{POST_AGAIN_WORDS.draftExists}</p>
      <div className={styles.actions}>
        <Button onClick={() => void start(true)} disabled={offline} loading={saving}>{POST_AGAIN_WORDS.replace}</Button>
        <Button variant="secondary" href="/jobs/new">{POST_AGAIN_WORDS.keep}</Button>
      </div>
    </Banner> : <>
      <Button icon="replay" loading={saving} disabled={offline ?? saving} onClick={() => void start(false)}>{POST_AGAIN_WORDS.button}</Button>
      <p className={styles.hint}>{POST_AGAIN_WORDS.hint}</p>
    </>}
    {state === "error" && <Banner tone="alert" live>{POST_AGAIN_WORDS.error}</Banner>}
  </div>;
}
