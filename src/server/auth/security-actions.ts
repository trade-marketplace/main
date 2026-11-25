"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { readSecurityForm, type SecurityOperation, type SecurityResult } from "@/lib/auth/security";
import { withRole } from "@/server/auth/guard";
import { changeSecurity } from "@/server/auth/security";
import { securityDeps } from "@/server/auth/security-deps";
import { SITE_URL } from "@/lib/metadata";
import { checkForClient, consumeForClient } from "@/server/rate-limit";
import { createSupabaseServerClient } from "@/server/supabase";

export const securityAction = withRole(["CUSTOMER", "TRADIE"], async (viewer, operation: SecurityOperation, _previous: SecurityResult | null, form: FormData): Promise<SecurityResult> => {
  // Server actions are POST-only with Next's Origin check; identity comes only from the checked session.
  if (!["email", "password", "sessions"].includes(operation)) return { ok: false, error: "unavailable" };
  try {
    // Every change asks for the current password, so this form could be used to guess it from a stolen session.
    // Wrong tries count towards the log-in limit for this connection (#220): slowed, never locked (DECISIONS.md, #340).
    if (!(await checkForClient("logInFailures")).allowed) return { ok: false, error: "try-later" };
    // Next checks the action's Origin against Host. Keep confirmation on the same deployment, including previews.
    const origin = (await headers()).get("origin") ?? SITE_URL.origin;
    const result = await changeSecurity(await securityDeps(), viewer.userId, readSecurityForm(operation, form), new URL("/profile/security/confirm", origin).href);
    if (!result.ok && result.error === "wrong-password") await consumeForClient("logInFailures");
    if (result.ok) revalidatePath("/", "layout");
    return result;
  } catch {
    return { ok: false, error: "unavailable" };
  }
});

/** A stale but still signed-in visitor cannot use the guest-only login route until this device signs out. */
export const endSecuritySessionAction = withRole(["CUSTOMER", "TRADIE"], async (): Promise<{ ok: true } | { ok: false; error: "unavailable" }> => {
  try {
    const { auth } = await createSupabaseServerClient();
    const { error } = await auth.signOut({ scope: "local" });
    if (error) return { ok: false, error: "unavailable" };
    revalidatePath("/", "layout");
    return { ok: true };
  } catch { return { ok: false, error: "unavailable" }; }
});
