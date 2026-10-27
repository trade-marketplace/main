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

/**
 * "Keep me logged in" (#102). Ticked: the session cookies last 30 days from the last visit (each refresh
 * re-sets them). Not ticked: they're browser-session cookies, gone when the browser closes. The choice is kept in
 * this marker cookie (itself a browser-session cookie), so the proxy's refreshes keep honouring it. Supabase
 * still decides when a session ends; this only decides how long the browser keeps the cookies.
 */
export const SESSION_ONLY_COOKIE = "tm-session-only";
export const REMEMBER_ME_MAX_AGE = 60 * 60 * 24 * 30;

/** The options for one session cookie Supabase wants to set. Deletions (empty value or max age 0) pass as they are. */
export function sessionCookieOptions(cookie: CookieToSet, sessionOnly: boolean): CookieOptions {
  const { options, value } = cookie;
  if (value === "" || options.maxAge === 0) return options;
  if (!sessionOnly) return { ...options, maxAge: REMEMBER_ME_MAX_AGE };
  const browserOnly = { ...options };
  delete browserOnly.maxAge;
  delete browserOnly.expires;
  return browserOnly;
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

/**
 * A Supabase client acting as the visitor whose cookies are in `jar`. Throws SupabaseNotConfiguredError.
 * `sessionOnly`: whether the session cookies it writes end with the browser session. Default: what the
 * visitor chose at log-in (the SESSION_ONLY_COOKIE marker in `jar`).
 */
export function createSupabaseClientWithCookies(jar: CookieJar, { sessionOnly }: { sessionOnly?: boolean } = {}) {
  const { url, publishableKey } = projectConfig();
  const browserSession = () => sessionOnly ?? jar.getAll().some((cookie) => cookie.name === SESSION_ONLY_COOKIE);
  return createServerClient(url, publishableKey, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll: jar.getAll,
      setAll: (cookies, headers) => {
        const only = browserSession();
        jar.setAll(cookies.map((cookie) => ({ ...cookie, options: sessionCookieOptions(cookie, only) })), headers);
      },
    },
  });
}

/**
 * Supabase client for Server Components, Server Actions and Route Handlers, signed in as the current visitor
 * through their cookies. Throws SupabaseNotConfiguredError until the keys are set.
 */
export async function createSupabaseServerClient(options: { sessionOnly?: boolean } = {}) {
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
  }, options);
}

/**
 * Remembers the "Keep me logged in" choice for the proxy's later refreshes (log-in only, so call it from an
 * action). Not ticked: sets the browser-session marker. Ticked: removes it.
 */
export async function rememberSessionChoice(sessionOnly: boolean): Promise<void> {
  const cookieStore = await cookies();
  if (sessionOnly) cookieStore.set(SESSION_ONLY_COOKIE, "1", authCookieOptions());
  else cookieStore.delete(SESSION_ONLY_COOKIE);
}
