import { afterLoginPath, loginPath, safeNextPath } from "./routes";
import type { Role } from "@/lib/mode";

export const VERIFICATION_COOLDOWN_SECONDS = 60;
export const VERIFICATION_POLL_MS = 5_000;

export type VerificationState = "ready" | "waiting" | "expired" | "invalid" | "verified" | "unavailable";
export type VerificationSendResult =
  | { ok: true; email: string; retryAt: number }
  | { ok: false; error: "invalid-email" | "unavailable" | "try-later"; retryAt?: number };
export type VerificationStatus = { verified: boolean; redirectTo: string };

export function verificationPath(next?: string | null): string {
  return `/verify?next=${encodeURIComponent(safeNextPath(next) ?? "/")}`;
}

export function verificationDestination(role: Role | undefined, next?: string | null): string {
  const safe = safeNextPath(next);
  const destination = safe && /^\/verify(?:\/|\?|#|$)/.test(safe) ? null : safe;
  return role ? afterLoginPath(role, destination) : loginPath(destination);
}

export function verificationSeconds(retryAt: number, now: number): number {
  return Math.max(0, Math.ceil((retryAt - now) / 1_000));
}
