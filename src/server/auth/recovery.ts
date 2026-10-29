import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { recoveryNext, recoveryPath } from "@/lib/auth/recovery";
import { SITE_URL } from "@/lib/metadata";
import { supabaseConfig } from "@/lib/supabase/config";
import { authCookieOptions, type CookieJar } from "@/server/supabase";

export const RECOVERY_AUTH_COOKIE = "tm-recovery-auth";
export const RECOVERY_PENDING_COOKIE = "tm-recovery-pending";
export const RECOVERY_SAVED_COOKIE = "tm-recovery-saved";

export function recoveryRetryAt() {
  return Date.now() + 60_000;
}

export function recoveryEmailUrl(next?: string | null, env: Record<string, string | undefined> = process.env): string {
  const configured = env.VERCEL_PROJECT_PRODUCTION_URL;
  const origin = configured && /^[a-z0-9.-]+$/i.test(configured) ? new URL(`https://${configured}`) : SITE_URL;
  const url = new URL("/recovery/confirm", origin);
  url.searchParams.set("next", recoveryNext(next) ?? "/");
  return url.href;
}

export function recoveryClientWithCookies(jar: CookieJar) {
  const { url, publishableKey } = supabaseConfig(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  return createServerClient(url, publishableKey, {
    cookieOptions: { ...authCookieOptions(), name: RECOVERY_AUTH_COOKIE, path: "/recovery", maxAge: 3_600 },
    cookies: {
      getAll: jar.getAll,
      setAll: (values, headers) => jar.setAll(values.map((cookie) => ({ ...cookie, options: { ...cookie.options, maxAge: cookie.value === "" || cookie.options.maxAge === 0 ? 0 : 3_600 } })), headers),
    },
  });
}

export async function recoveryClient({ readOnly = false }: { readOnly?: boolean } = {}) {
  const jar = await cookies();
  return recoveryClientWithCookies({
    getAll: () => jar.getAll(),
    setAll: (values) => {
      if (!readOnly) for (const { name, value, options } of values) jar.set(name, value, options);
    },
  });
}

export async function pendingRecovery(): Promise<{ email: string; retryAt: number } | null> {
  const value = (await cookies()).get(RECOVERY_PENDING_COOKIE)?.value;
  try {
    const parsed = JSON.parse(value ?? "null");
    return parsed && typeof parsed.email === "string" && typeof parsed.retryAt === "number" && Number.isFinite(parsed.retryAt) ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearRecovery() {
  const jar = await cookies();
  for (const cookie of jar.getAll()) {
    if (cookie.name === RECOVERY_AUTH_COOKIE || cookie.name.startsWith(`${RECOVERY_AUTH_COOKIE}.`) || cookie.name === RECOVERY_SAVED_COOKIE) {
      jar.set(cookie.name, "", { ...authCookieOptions(), path: "/recovery", maxAge: 0 });
    }
  }
}

export function recoveryStatePath(state: string, next?: string | null) {
  const url = new URL(recoveryPath(next), "https://same.invalid");
  url.searchParams.set("state", state);
  return `${url.pathname}${url.search}`;
}
