import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

import { supabaseConfig } from "@/lib/supabase/config";

/**
 * How the session cookies are set (#101). On top of @supabase/ssr's defaults (path `/`, 400-day max age):
 * - `httpOnly`: page scripts can't read the tokens, so an injected script can't steal a session. The browser
 *   Supabase client therefore runs signed out; anything that needs the user goes through our server.
 * - `secure`: only sent over HTTPS (off in `next dev` on plain http://localhost).
 * - `sameSite: "lax"`: not sent on cross-site POSTs, one of the two CSRF guards (docs/ARCHITECTURE.md).
 * Supabase still decides when a session ends (JWT expiry + refresh token), not the cookie's max age.
 */
export function authCookieOptions(env: Record<string, string | undefined> = process.env): CookieOptions {
  return { path: "/", sameSite: "lax", httpOnly: true, secure: env.NODE_ENV === "production" };
}

function projectConfig() {
  return supabaseConfig(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

export type CookieToSet = { name: string; value: string; options: CookieOptions };

/** Where a Supabase client reads the visitor's cookies and writes refreshed ones. */
export type CookieJar = {
  getAll: () => { name: string; value: string }[];
  setAll: (cookies: CookieToSet[], headers: Record<string, string>) => void;
};

/** A Supabase client acting as the visitor whose cookies are in `jar`. Throws SupabaseNotConfiguredError. */
export function createSupabaseClientWithCookies(jar: CookieJar) {
  const { url, publishableKey } = projectConfig();
  return createServerClient(url, publishableKey, {
    cookieOptions: authCookieOptions(),
    cookies: { getAll: jar.getAll, setAll: jar.setAll },
  });
}

/**
 * Supabase client for Server Components, Server Actions and Route Handlers, signed in as the current visitor
 * through their cookies. Throws SupabaseNotConfiguredError until the keys are set.
 */
export async function createSupabaseServerClient() {
  projectConfig(); // Fail with the "how to connect" message before touching the request's cookies.
  const cookieStore = await cookies();
  return createSupabaseClientWithCookies({
    getAll: () => cookieStore.getAll(),
    setAll: (cookiesToSet) => {
      try {
        for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
      } catch {
        // Server Components can't set cookies. That's fine: the proxy (src/proxy.ts) already refreshed the
        // session before the page started rendering, and actions and route handlers can set them.
      }
    },
  });
}
