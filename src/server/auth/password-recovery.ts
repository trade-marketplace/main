import "server-only";

import { z } from "zod";

import { RECOVERY_COOLDOWN_SECONDS, recoveryPasswordErrors, type RecoverySaveResult, type RecoverySendResult } from "@/lib/auth/recovery";
import type { AuthUserLike } from "@/server/auth/account";

type AuthError = { code?: string; status?: number };
export type RecoveryAuth = {
  resetPasswordForEmail(email: string, options: { redirectTo: string }): Promise<{ error: AuthError | null }>;
  verifyOtp(input: { token_hash: string; type: "recovery" }): Promise<{ data: { user: AuthUserLike | null }; error: AuthError | null }>;
  getUser(): Promise<{ data: { user: AuthUserLike | null }; error: AuthError | null }>;
  updateUser(input: { password: string }): Promise<{ error: AuthError | null }>;
  getSession(): Promise<{ data: { session: { access_token: string } | null }; error: AuthError | null }>;
  admin: { signOut(jwt: string, scope: "global"): Promise<{ error: AuthError | null }> };
};

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
const limited = (error: AuthError) => error.status === 429 || error.code?.startsWith("over_");
const invalidSession = (error: AuthError) => error.status === 401 || error.status === 403 || ["session_not_found", "session_expired", "refresh_token_not_found", "user_not_found"].includes(error.code ?? "");

export async function sendRecovery(auth: Pick<RecoveryAuth, "resetPasswordForEmail">, input: string, redirectTo: string, now = Date.now()): Promise<RecoverySendResult> {
  const parsed = emailSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid-email" };
  const retryAt = now + RECOVERY_COOLDOWN_SECONDS * 1_000;
  try {
    const { error } = await auth.resetPasswordForEmail(parsed.data, { redirectTo });
    if (error && limited(error)) return { ok: false, error: "try-later", retryAt };
    if (error && error.code !== "user_not_found") return { ok: false, error: "unavailable" };
    return { ok: true, email: parsed.data, retryAt };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function confirmRecovery(auth: Pick<RecoveryAuth, "verifyOtp">, tokenHash: string | null, type: string | null): Promise<"reset" | "expired" | "invalid" | "unavailable"> {
  if (!tokenHash || tokenHash.length > 2_048 || type !== "recovery") return "invalid";
  try {
    const { data, error } = await auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
    if (error) return error.code === "otp_expired" ? "expired" : error.status && error.status >= 500 ? "unavailable" : "invalid";
    return data.user?.id && data.user.email ? "reset" : "invalid";
  } catch {
    return "unavailable";
  }
}

export async function saveRecoveryPassword(auth: Pick<RecoveryAuth, "getUser" | "updateUser">, password: string, confirmation: string): Promise<RecoverySaveResult> {
  try {
    const { data, error } = await auth.getUser();
    if (error) return { ok: false, error: invalidSession(error) ? "invalid" : "unavailable" };
    if (!data.user?.email) return { ok: false, error: "invalid" };
    const problems = recoveryPasswordErrors(password, confirmation, data.user.email);
    if (problems.password) return { ok: false, error: "password", message: problems.password };
    if (problems.confirmation) return { ok: false, error: "confirmation", message: problems.confirmation };
    const update = await auth.updateUser({ password });
    if (!update.error) return { ok: true };
    if (update.error.code === "weak_password") return { ok: false, error: "password", message: "Choose a stronger password." };
    if (update.error.code === "same_password") return { ok: false, error: "password", message: "Choose a different password." };
    return { ok: false, error: limited(update.error) ? "try-later" : invalidSession(update.error) ? "invalid" : "unavailable" };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function finishRecovery(auth: Pick<RecoveryAuth, "getSession" | "admin">): Promise<RecoverySaveResult> {
  try {
    const session = await auth.getSession();
    if (!session.data.session || session.error) return { ok: false, error: "invalid", message: "Password saved. Request a new link to finish signing out." };
    const { error } = await auth.admin.signOut(session.data.session.access_token, "global");
    if (error && invalidSession(error)) return { ok: false, error: "invalid", message: "Password saved. Request a new link to finish signing out." };
    return error ? { ok: false, error: "sign-out" } : { ok: true };
  } catch {
    return { ok: false, error: "sign-out" };
  }
}
