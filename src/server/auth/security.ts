import "server-only";

import { type SecurityInput, type SecurityResult, validateSecurity } from "@/lib/auth/security";

type AuthError = { code?: string; status?: number; message?: string };
export type SecurityUser = { id: string; email?: string; new_email?: string; email_confirmed_at?: string };
type UserResponse = { data: { user: SecurityUser | null }; error: AuthError | null };

export type SecurityAuth = {
  getUser(): Promise<UserResponse>;
  updateUser(attributes: { email?: string; password?: string; current_password?: string }, options?: { emailRedirectTo?: string }): Promise<UserResponse>;
  signOut(options: { scope: "others" | "local" }): Promise<{ error: AuthError | null }>;
};

export type SecurityDeps = {
  auth: SecurityAuth;
  /** Verifies the password with an isolated client: never replaces this browser's session. */
  verifyPassword(email: string, password: string): Promise<UserResponse>;
  syncEmail(user: SecurityUser): Promise<void>;
};

function failure(error: AuthError | null): SecurityResult {
  if (error?.status === 429 || error?.code?.startsWith("over_")) return { ok: false, error: "try-later" };
  if (["session_not_found", "session_expired", "refresh_token_not_found", "bad_jwt", "user_not_found"].includes(error?.code ?? "")) return { ok: false, error: "session-expired" };
  if (["invalid_credentials", "invalid_current_password"].includes(error?.code ?? "")) return { ok: false, error: "wrong-password", fields: { currentPassword: "That’s not your current password." } };
  if (["reauthentication_needed", "reauthentication_not_valid"].includes(error?.code ?? "")) return { ok: false, error: "reauthenticate" };
  if (["email_exists", "user_already_exists"].includes(error?.code ?? "")) return { ok: false, error: "email-taken", fields: { email: "That email is already in use." } };
  if (["weak_password", "same_password"].includes(error?.code ?? "")) return { ok: false, error: "invalid", fields: { password: "Choose a different, stronger password." } };
  return { ok: false, error: "unavailable" };
}

/** Auth owns the email; never copy an unconfirmed address from a form into profiles. */
export async function readSecurityUser(deps: Pick<SecurityDeps, "auth" | "syncEmail">, userId: string) {
  const { data, error } = await deps.auth.getUser();
  if (error) throw error;
  if (!data.user?.email || data.user.id !== userId) return null;
  await deps.syncEmail(data.user);
  return data.user;
}

export async function changeSecurity(deps: SecurityDeps, userId: string, input: SecurityInput, emailRedirectTo: string): Promise<SecurityResult> {
  try {
    const user = await readSecurityUser(deps, userId);
    if (!user?.email) return { ok: false, error: "session-expired" };
    const invalid = validateSecurity(input, user.email);
    if (invalid) return invalid;
    const verified = await deps.verifyPassword(user.email, input.currentPassword);
    if (verified.error) return failure(verified.error);
    if (verified.data.user?.id !== user.id) return { ok: false, error: "session-expired" };

    if (input.operation === "sessions") {
      const { error } = await deps.auth.signOut({ scope: "others" });
      return error ? failure(error) : { ok: true, status: "sessions-ended" };
    }
    const { data, error } = await deps.auth.updateUser(input.operation === "email"
      ? { email: input.email.trim().toLowerCase() }
      : { password: input.password, current_password: input.currentPassword },
    input.operation === "email" ? { emailRedirectTo } : undefined);
    if (error) return failure(error);
    if (!data.user || data.user.id !== userId) return { ok: false, error: "unavailable" };
    if (input.operation === "email") {
      await deps.syncEmail(data.user);
      return data.user.email?.toLowerCase() === input.email.trim().toLowerCase()
        ? { ok: true, status: "email-changed", email: data.user.email }
        : { ok: true, status: "email-sent", email: input.email.trim().toLowerCase() };
    }
    try {
      const ended = await deps.auth.signOut({ scope: "others" });
      return ended.error ? { ok: false, error: "sessions-failed" } : { ok: true, status: "password-changed" };
    } catch {
      return { ok: false, error: "sessions-failed" };
    }
  } catch (error) {
    // Never return provider messages, credentials or tokens to the browser/logs.
    return failure(typeof error === "object" && error !== null ? error : null);
  }
}
