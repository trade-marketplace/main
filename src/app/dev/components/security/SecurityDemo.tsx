"use client";

import { SecuritySettings, type SecurityAction } from "@/components/account/SecuritySettings";
import { validateSecurity, type SecurityResult } from "@/lib/auth/security";

// Isolated UI exercise: never calls an Auth provider or database. The real forms use securityAction.
export function SecurityDemo({ state }: { state: string }) {
  const action: SecurityAction = async (operation, _previous, form) => {
    if (state === "saving") await new Promise(resolve => setTimeout(resolve, 2000));
    const input = { operation, currentPassword: String(form.get("currentPassword") ?? ""), email: String(form.get("email") ?? ""), password: String(form.get("password") ?? ""), confirmPassword: String(form.get("confirmPassword") ?? "") };
    const invalid = validateSecurity(input, "sarah@example.test");
    if (invalid) return invalid;
    if (input.currentPassword !== "demo-current-password") return { ok: false, error: "wrong-password", fields: { currentPassword: "That’s not your current password." } };
    if (state === "unavailable") return { ok: false, error: "unavailable" };
    return operation === "email" ? { ok: true, status: "email-sent", email: input.email } : { ok: true, status: operation === "password" ? "password-changed" : "sessions-ended" };
  };
  const initial: Record<string, SecurityResult> = {
    wrong: { ok: false, error: "wrong-password", fields: { currentPassword: "That’s not your current password." } },
    unavailable: { ok: false, error: "unavailable" },
    limited: { ok: false, error: "try-later" },
    expired: { ok: false, error: "session-expired" },
    partial: { ok: false, error: "sessions-failed" },
    success: { ok: true, status: "password-changed" },
  };
  return <SecuritySettings email="sarah@example.test" action={action} initial={state === "access-errors" ? {
    email: { ok: false, error: "reauthenticate" }, password: { ok: false, error: "try-later" }, sessions: { ok: false, error: "session-expired" },
  } : initial[state] ? { password: initial[state] } : undefined} confirmError={state === "invalid-link"} pendingEmail={state === "pending-email" ? "new@example.test" : undefined} preview={state === "offline" || state === "pending" ? state : undefined} />;
}
