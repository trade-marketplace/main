import { passwordMessage } from "@/lib/auth/password";
import { loginPath, safeNextPath } from "@/lib/auth/routes";

export const RECOVERY_COOLDOWN_SECONDS = 60;
export type RecoveryState = "request" | "sent" | "reset" | "complete" | "expired" | "invalid" | "unavailable" | "finish";
export type RecoverySendResult = { ok: true; email: string; retryAt: number } | { ok: false; error: "invalid-email" | "try-later" | "unavailable"; retryAt?: number };
export type RecoverySaveResult = { ok: true } | { ok: false; error: "invalid" | "unavailable" | "try-later" | "sign-out" | "password" | "confirmation"; message?: string };

export function recoveryNext(next?: string | null): string | null {
  const safe = safeNextPath(next);
  if (!safe) return null;
  const pathname = new URL(safe, "https://same.invalid").pathname;
  return /^\/(recovery|login|signup|verify)(\/|$)/.test(pathname) ? null : safe;
}

export function recoveryPath(next?: string | null): string {
  const safe = recoveryNext(next);
  return safe ? `/recovery?next=${encodeURIComponent(safe)}` : "/recovery";
}

export function recoveryLoginPath(next?: string | null): string {
  return loginPath(recoveryNext(next));
}

export function recoveryPasswordErrors(password: string, confirmation: string, email?: string | null) {
  return {
    password: passwordMessage(password, email) ?? undefined,
    confirmation: password === confirmation ? undefined : "These don’t match.",
  };
}

export function recoverySeconds(retryAt: number, now = Date.now()): number {
  return Math.max(0, Math.min(RECOVERY_COOLDOWN_SECONDS, Math.ceil((retryAt - now) / 1_000)));
}
