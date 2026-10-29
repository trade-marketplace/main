import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { decideRoute, routeAccess } from "@/lib/auth/routes";
import { SupabaseNotConfiguredError } from "@/lib/supabase/config";
import type { Role } from "@/lib/mode";
import { findProfile } from "@/server/auth/viewer";
import { DatabaseNotConfiguredError } from "@/server/db";
import { createSupabaseClientWithCookies, type CookieJar } from "@/server/supabase";

// What the proxy (src/proxy.ts) does on every request (#101):
// 1. Refresh the Supabase session. An access token lasts an hour; when it's out of date, Supabase swaps the
//    refresh token for a new pair and we write them back as cookies, on the request (so the page rendering
//    after us sees them) and on the response (so the browser keeps them).
// 2. For page visits only, send people where they belong (src/lib/auth/routes.ts): signed out → log in,
//    wrong role → their home.

export type RefreshSources = {
  /** Checks the session in `jar`, refreshing it if needed (writing through `jar.setAll`). The user id or null. */
  readUserId: (jar: CookieJar) => Promise<string | null>;
  findRole: (userId: string) => Promise<Role | null>;
};

async function readUserIdWithSupabase(jar: CookieJar): Promise<string | null> {
  let supabase;
  try {
    supabase = createSupabaseClientWithCookies(jar);
  } catch (error) {
    if (error instanceof SupabaseNotConfiguredError) return null;
    throw error;
  }
  // getUser() refreshes an expired access token first, then checks the active session. Don't run code between creating the
  // client and this call: a refresh that's skipped here can log people out at random.
  const { data, error } = await supabase.auth.getUser();
  return !error && typeof data.user?.id === "string" ? data.user.id : null;
}

async function findRoleInProfiles(userId: string): Promise<Role | null> {
  try {
    return (await findProfile(userId))?.role ?? null;
  } catch (error) {
    if (!(error instanceof DatabaseNotConfiguredError)) throw error;
    console.error(`Signed-in visitor treated as signed out: ${error.message}`);
    return null;
  }
}

export const defaultRefreshSources: RefreshSources = { readUserId: readUserIdWithSupabase, findRole: findRoleInProfiles };

/**
 * Page visits get redirected; nothing else does. Server actions are POSTs to the page's URL (with a
 * `Next-Action` header): redirecting one to /login would lose the form, so the action runs and answers
 * "session-expired" itself (src/server/auth/guard.ts). Route handlers answer 401/403 the same way.
 */
function isPageVisit(request: NextRequest): boolean {
  const method = request.method.toUpperCase();
  return (method === "GET" || method === "HEAD") && !request.headers.has("next-action");
}

export async function refreshSession(
  request: NextRequest,
  sources: RefreshSources = defaultRefreshSources,
): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const headersToSet: Record<string, string> = {};

  const jar: CookieJar = {
    getAll: () => request.cookies.getAll(),
    setAll: (cookiesToSet, headers) => {
      for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
      // Rebuild the response so the page sees the request's new cookies, then set them for the browser too.
      response = NextResponse.next({ request });
      for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      // @supabase/ssr asks for no-store when it sets session cookies, so no CDN caches one person's tokens.
      Object.assign(headersToSet, headers);
    },
  };

  const userId = await sources.readUserId(jar);
  for (const [key, value] of Object.entries(headersToSet)) response.headers.set(key, value);

  if (!isPageVisit(request)) return response;
  const { pathname, search } = request.nextUrl;
  // Public pages don't need the role, so they cost no database read.
  if (routeAccess(pathname).kind === "public") return response;

  const role = userId ? await sources.findRole(userId) : null;
  const decision = decideRoute(pathname, role ? { role } : null, `${pathname}${search}`);
  if (decision.action === "allow") return response;

  const redirect = NextResponse.redirect(new URL(decision.to, request.url));
  // Keep any refreshed session cookies, or the browser would carry on with the old, used-up refresh token.
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  for (const [key, value] of Object.entries(headersToSet)) redirect.headers.set(key, value);
  return redirect;
}
