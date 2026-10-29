"use client";

import { VerifyEmail } from "@/components/auth/VerifyEmail";
import { VERIFICATION_COOLDOWN_SECONDS, type VerificationSendResult, type VerificationState } from "@/lib/auth/verification";

export function VerifyEmailPreview({ state, retryAt }: { state: string; retryAt: number }) {
  const initialState: VerificationState = ["expired", "invalid", "verified", "unavailable", "ready"].includes(state) ? state as VerificationState : "waiting";
  async function send(email: string): Promise<VerificationSendResult> {
    if (!email.includes("@")) return { ok: false, error: "invalid-email" };
    if (state === "send-error") return { ok: false, error: "unavailable" };
    return { ok: true, email, retryAt: Date.now() + VERIFICATION_COOLDOWN_SECONDS * 1_000 };
  }
  async function check() {
    if (state === "poll-error") throw new Error("Preview unavailable");
    return { verified: false, redirectTo: "/login" };
  }
  return <VerifyEmail initialState={initialState} initialEmail={state === "ready" ? "" : "sarah@example.test"}
    initialError={state === "send-error" ? "Couldn’t send the link. Try again." : state === "poll-error" ? "Can’t check your email yet. We’ll try again." : undefined}
    initialRetryAt={state === "cooldown" ? retryAt : 0} initialSeconds={state === "cooldown" ? VERIFICATION_COOLDOWN_SECONDS : 0}
    continueTo="/login?next=%2Fjobs%2Fnew%3Fstep%3Dreview" next="/jobs/new?step=review" signedIn={state === "signed-in"} send={send} check={check} previewPending={state === "loading"} previewOffline={state === "offline"} />;
}
