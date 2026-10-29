"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { VERIFICATION_COOLDOWN_SECONDS, verificationDestination, type VerificationSendResult, type VerificationStatus } from "@/lib/auth/verification";
import { safeNextPath } from "@/lib/auth/routes";
import { logOut } from "@/server/auth/account";
import { getViewer } from "@/server/auth/viewer";
import { pendingVerification, startVerification, VERIFICATION_COMPLETE_COOKIE, VERIFICATION_PENDING_COOKIE } from "@/server/auth/verification";
import { createSupabaseServerClient } from "@/server/supabase";

export async function resendVerificationAction(email: string, next?: string): Promise<VerificationSendResult> {
  try {
    const viewer = await getViewer();
    const pending = await pendingVerification();
    const target = viewer?.email ?? email;
    if (pending?.email.toLowerCase() === target.trim().toLowerCase() && pending.retryAt > Date.now()) {
      return { ok: false, error: "try-later", retryAt: Math.min(pending.retryAt, Date.now() + VERIFICATION_COOLDOWN_SECONDS * 1_000) };
    }
    return await startVerification(target, next);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function verificationStatusAction(next?: string): Promise<VerificationStatus> {
  const viewer = await getViewer();
  const complete = (await cookies()).get(VERIFICATION_COMPLETE_COOKIE)?.value === "1";
  return { verified: viewer ? viewer.emailVerified : complete, redirectTo: verificationDestination(viewer?.role, next) };
}

export async function changeVerificationAccountAction(formData: FormData): Promise<void> {
  const client = await createSupabaseServerClient();
  await logOut(client.auth);
  const jar = await cookies();
  jar.delete(VERIFICATION_COMPLETE_COOKIE);
  jar.set(VERIFICATION_PENDING_COOKIE, "", { path: "/verify", maxAge: 0 });
  revalidatePath("/", "layout");
  const next = safeNextPath(String(formData.get("next") ?? ""));
  redirect(next ? `/signup?next=${encodeURIComponent(next)}` : "/signup");
}
