"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { RECOVERY_COOLDOWN_SECONDS, type RecoverySaveResult, type RecoverySendResult } from "@/lib/auth/recovery";
import { finishRecovery, saveRecoveryPassword, sendRecovery } from "@/server/auth/password-recovery";
import { clearRecovery, pendingRecovery, RECOVERY_PENDING_COOKIE, RECOVERY_SAVED_COOKIE, recoveryClient, recoveryEmailUrl } from "@/server/auth/recovery";
import { verificationAuth } from "@/server/auth/verification";
import { authCookieOptions, createSupabaseServerClient } from "@/server/supabase";

export async function requestRecoveryAction(email: string, next?: string): Promise<RecoverySendResult> {
  try {
    const pending = await pendingRecovery();
    if (pending?.email.toLowerCase() === email.trim().toLowerCase() && pending.retryAt > Date.now()) {
      return { ok: false, error: "try-later", retryAt: Math.min(pending.retryAt, Date.now() + RECOVERY_COOLDOWN_SECONDS * 1_000) };
    }
    const result = await sendRecovery(verificationAuth(), email, recoveryEmailUrl(next));
    if (result.ok || result.error === "try-later") {
      const jar = await cookies();
      jar.set(RECOVERY_PENDING_COOKIE, JSON.stringify({ email: result.ok ? result.email : email.trim().toLowerCase(), retryAt: result.retryAt }), { ...authCookieOptions(), path: "/recovery", maxAge: 3_600 });
    }
    return result;
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function saveRecoveryAction(password: string, confirmation: string): Promise<RecoverySaveResult> {
  try {
    const jar = await cookies();
    const client = await recoveryClient();
    if (jar.get(RECOVERY_SAVED_COOKIE)?.value !== "1") {
      const result = await saveRecoveryPassword(client.auth, password, confirmation);
      if (!result.ok) {
        if (result.error === "invalid") await clearRecovery();
        return result;
      }
      jar.set(RECOVERY_SAVED_COOKIE, "1", { ...authCookieOptions(), path: "/recovery", maxAge: 3_600 });
    }
    const finished = await finishRecovery(client.auth);
    if (!finished.ok) {
      if (finished.error === "invalid") await clearRecovery();
      return finished;
    }
    await clearRecovery();
    jar.set(RECOVERY_PENDING_COOKIE, "", { ...authCookieOptions(), path: "/recovery", maxAge: 0 });
    try {
      const normal = await createSupabaseServerClient();
      await normal.auth.signOut({ scope: "local" });
    } catch {}
    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
