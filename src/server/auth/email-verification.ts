import "server-only";

import { z } from "zod";

import { VERIFICATION_COOLDOWN_SECONDS, type VerificationSendResult } from "@/lib/auth/verification";
import type { AuthUserLike } from "@/server/auth/account";
import type { ProfileRow } from "@/server/auth/viewer";

type AuthError = { code?: string; status?: number };
export type VerificationAuth = {
  signInWithOtp(input: { email: string; options: { shouldCreateUser: false; emailRedirectTo: string } }): Promise<{ error: AuthError | null }>;
  verifyOtp(input: { token_hash: string; type: "email" }): Promise<{ data: { user: AuthUserLike | null }; error: AuthError | null }>;
  signOut(input: { scope: "local" }): Promise<unknown>;
};

export type VerificationProfiles = {
  find(id: string): Promise<ProfileRow | null>;
  markVerified(id: string, email: string, at: Date): Promise<boolean>;
};

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export async function sendVerification(
  auth: VerificationAuth,
  input: string,
  redirectTo: string,
  now = Date.now(),
): Promise<VerificationSendResult> {
  const parsed = emailSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid-email" };
  const retryAt = now + VERIFICATION_COOLDOWN_SECONDS * 1_000;
  try {
    const { error } = await auth.signInWithOtp({ email: parsed.data, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
    if (error?.status === 429 || error?.code?.startsWith("over_")) return { ok: false, error: "try-later", retryAt };
    if (error && error.code !== "otp_disabled" && error.code !== "user_not_found" && error.code !== "signup_disabled") {
      return { ok: false, error: "unavailable" };
    }
    return { ok: true, email: parsed.data, retryAt };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function confirmVerification(
  auth: VerificationAuth,
  profiles: VerificationProfiles,
  tokenHash: string | null,
  type: string | null,
  now = new Date(),
): Promise<"verified" | "expired" | "invalid" | "unavailable"> {
  if (!tokenHash || tokenHash.length > 2_048 || type !== "email") return "invalid";
  try {
    const { data, error } = await auth.verifyOtp({ token_hash: tokenHash, type: "email" });
    if (error) return error.code === "otp_expired" ? "expired" : error.status && error.status >= 500 ? "unavailable" : "invalid";
    try {
      if (!data.user?.email) return "invalid";
      const profile = await profiles.find(data.user.id);
      if (!profile || profile.email.toLowerCase() !== data.user.email.toLowerCase()) return "invalid";
      if (profile.emailVerifiedAt) return "verified";
      return await profiles.markVerified(profile.id, profile.email, now) ? "verified" : "invalid";
    } finally {
      await auth.signOut({ scope: "local" });
    }
  } catch {
    return "unavailable";
  }
}
