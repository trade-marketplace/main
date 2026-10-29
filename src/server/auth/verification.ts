import "server-only";

import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { VERIFICATION_COOLDOWN_SECONDS, verificationPath, verificationSeconds, type VerificationSendResult } from "@/lib/auth/verification";
import { SITE_URL } from "@/lib/metadata";
import { supabaseConfig } from "@/lib/supabase/config";
import { sendVerification } from "@/server/auth/email-verification";
import { PROFILE_SELECT } from "@/server/auth/viewer";
import { getDb } from "@/server/db";
import { authCookieOptions } from "@/server/supabase";

export const VERIFICATION_PENDING_COOKIE = "tm-verification-pending";
export const VERIFICATION_COMPLETE_COOKIE = "tm-verification-complete";

export function verificationTiming(retryAt = Date.now() + VERIFICATION_COOLDOWN_SECONDS * 1_000) {
  return { retryAt, seconds: verificationSeconds(retryAt, Date.now()) };
}

export function verificationAuth() {
  const { url, publishableKey } = supabaseConfig(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: "implicit" },
  }).auth;
}

export const verificationProfiles = {
  find: (id: string) => getDb().profile.findUnique({ where: { id }, select: PROFILE_SELECT }),
  markVerified: async (id: string, email: string, at: Date) => {
    const result = await getDb().profile.updateMany({ where: { id, email }, data: { emailVerifiedAt: at } });
    return result.count === 1;
  },
};

export function verificationEmailUrl(next?: string | null): string {
  const path = verificationPath(next).replace("/verify?", "/verify/confirm?");
  return new URL(path, SITE_URL).href;
}

export async function pendingVerification(): Promise<{ email: string; retryAt: number } | null> {
  const value = (await cookies()).get(VERIFICATION_PENDING_COOKIE)?.value;
  try {
    const parsed = JSON.parse(value ?? "null");
    return parsed && typeof parsed.email === "string" && typeof parsed.retryAt === "number" ? parsed : null;
  } catch {
    return null;
  }
}

export async function rememberVerification(email: string, retryAt: number) {
  const jar = await cookies();
  jar.set(VERIFICATION_PENDING_COOKIE, JSON.stringify({ email, retryAt }), { ...authCookieOptions(), maxAge: 86_400, path: "/verify" });
  jar.delete(VERIFICATION_COMPLETE_COOKIE);
}

export async function startVerification(email: string, next?: string | null): Promise<VerificationSendResult> {
  let result: VerificationSendResult;
  try {
    result = await sendVerification(verificationAuth(), email, verificationEmailUrl(next));
  } catch {
    result = { ok: false, error: "unavailable" };
  }
  if (result.ok || result.error === "try-later") await rememberVerification(email, result.retryAt ?? 0);
  return result;
}
