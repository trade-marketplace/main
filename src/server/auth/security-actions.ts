"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { readSecurityForm, type SecurityOperation, type SecurityResult } from "@/lib/auth/security";
import { withRole } from "@/server/auth/guard";
import { changeSecurity } from "@/server/auth/security";
import { securityDeps } from "@/server/auth/security-deps";
import { SITE_URL } from "@/lib/metadata";
import { createSupabaseServerClient } from "@/server/supabase";

export const securityAction = withRole(["CUSTOMER", "TRADIE"], async (viewer, operation: SecurityOperation, _previous: SecurityResult | null, form: FormData): Promise<SecurityResult> => {
  // Server actions are POST-only with Next's Origin check; identity comes only from the checked session.
  if (!["email", "password", "sessions"].includes(operation)) return { ok: false, error: "unavailable" };
  try {
    // Next checks the action's Origin against Host. Keep confirmation on the same deployment, including previews.
    const origin = (await headers()).get("origin") ?? SITE_URL.origin;
    const result = await changeSecurity(await securityDeps(), viewer.userId, readSecurityForm(operation, form), new URL("/profile/security/confirm", origin).href);
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
