import { NextRequest, NextResponse } from "next/server";

import { confirmRecovery } from "@/server/auth/password-recovery";
import { RECOVERY_AUTH_COOKIE, RECOVERY_SAVED_COOKIE, recoveryClientWithCookies, recoveryStatePath } from "@/server/auth/recovery";
import { authCookieOptions, type CookieToSet } from "@/server/supabase";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const values: CookieToSet[] = [];
  let state: "reset" | "expired" | "invalid" | "unavailable" = "unavailable";
  try {
    const client = recoveryClientWithCookies({ getAll: () => [], setAll: (cookies) => { values.push(...cookies); } });
    state = await confirmRecovery(client.auth, params.get("token_hash"), params.get("type"));
  } catch {}
  const response = NextResponse.redirect(new URL(recoveryStatePath(state, params.get("next")), request.url));
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name === RECOVERY_AUTH_COOKIE || cookie.name.startsWith(`${RECOVERY_AUTH_COOKIE}.`)) {
      response.cookies.set(cookie.name, "", { ...authCookieOptions(), path: "/recovery", maxAge: 0 });
    }
  }
  response.cookies.set(RECOVERY_SAVED_COOKIE, "", { ...authCookieOptions(), path: "/recovery", maxAge: 0 });
  if (state === "reset") {
    for (const { name, value, options } of values) response.cookies.set(name, value, options);
  }
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
