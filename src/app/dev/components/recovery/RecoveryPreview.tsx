"use client";

import { RecoveryFlow } from "@/components/auth/RecoveryFlow";
import { RECOVERY_COOLDOWN_SECONDS, type RecoverySaveResult, type RecoverySendResult, type RecoveryState } from "@/lib/auth/recovery";

export function RecoveryPreview({ state, retryAt, embedded = false }: { state: string; retryAt: number; embedded?: boolean }) {
  const initialState: RecoveryState = ["request", "sent", "reset", "complete", "expired", "invalid", "unavailable", "finish"].includes(state) ? state as RecoveryState
    : ["mismatch", "save-error", "reset-loading", "reset-offline"].includes(state) ? "reset" : state === "cooldown" ? "sent" : "request";
  async function send(email: string): Promise<RecoverySendResult> {
    if (!email.includes("@")) return { ok: false, error: "invalid-email" };
    if (state === "send-error") return { ok: false, error: "unavailable" };
    return { ok: true, email: email.trim().toLowerCase(), retryAt: Date.now() + RECOVERY_COOLDOWN_SECONDS * 1_000 };
  }
  async function save(): Promise<RecoverySaveResult> {
    if (state === "save-error") return { ok: false, error: "unavailable" };
    return { ok: true };
  }
  return <RecoveryFlow initialState={initialState} initialEmail={initialState === "request" ? "" : "sarah@example.test"}
    initialRetryAt={state === "cooldown" ? retryAt : 0} initialSeconds={state === "cooldown" ? RECOVERY_COOLDOWN_SECONDS : 0}
    initialError={state === "send-error" ? "Couldn’t send the link. Try again." : state === "save-error" ? "Couldn’t save your password. Try again." : undefined}
    next="/jobs/new?step=review" send={send} save={save} previewMismatch={state === "mismatch"} previewName={embedded ? `Recovery preview: ${state}` : undefined}
    previewPending={state === "loading" || state === "reset-loading"} previewOffline={state === "offline" || state === "reset-offline"} />;
}
