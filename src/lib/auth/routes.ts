// Who may open which page, and where everyone's home is (#101). Pure functions, safe on server and browser: the
// proxy (src/proxy.ts) uses them to redirect, and log-in uses them to pick where to go next.
// Routes come from docs/design/sitemap.json. A page that isn't listed here is public.

import type { Role } from "@/lib/mode";

/** Where each role lands after log-in, and where they're sent from a page that isn't theirs. */
export const HOME_BY_ROLE: Readonly<Record<Role, string>> = {
  CUSTOMER: "/",
  TRADIE: "/jobs",
  ADMIN: "/admin",
};

export const LOGIN_PATH = "/login";

export function homeForRole(role: Role): string {
  return HOME_BY_ROLE[role];
}

/**
 * - `public`: anyone, signed in or not (marketing, help, legal, verify email, reset password).
 * - `guest`: log-in and sign-up. Someone already signed in is sent to their home.
 * - `landing`: `/`. Signed out it's the public landing page; signed in it's the customer home, so a tradie or
 *   office user is sent to their own home (WEBAPP_SPEC A01).
 * - `roles`: signed in with one of these roles. Signed out → log in; wrong role → their home.
 */
export type RouteAccess =
  | { kind: "public" }
  | { kind: "guest" }
  | { kind: "landing" }
  | { kind: "roles"; roles: readonly Role[] };

const CUSTOMER: readonly Role[] = ["CUSTOMER"];
const TRADIE: readonly Role[] = ["TRADIE"];
const ADMIN: readonly Role[] = ["ADMIN"];
// Pages both sides of a job use (the page shows each side its own view). Office users have their own /admin pages.
const APP_USER: readonly Role[] = ["CUSTOMER", "TRADIE"];

type Rule = { pattern: RegExp; access: RouteAccess };

// First match wins, so more specific paths come before the prefixes that contain them.
const RULES: readonly Rule[] = [
  { pattern: /^\/$/, access: { kind: "landing" } },
  { pattern: /^\/login$/, access: { kind: "guest" } },
  { pattern: /^\/signup(\/.*)?$/, access: { kind: "guest" } },

  { pattern: /^\/admin(\/.*)?$/, access: { kind: "roles", roles: ADMIN } },

  // Customer only.
  { pattern: /^\/jobs\/new$/, access: { kind: "roles", roles: CUSTOMER } },
  { pattern: /^\/jobs\/[^/]+\/problem$/, access: { kind: "roles", roles: CUSTOMER } },
  { pattern: /^\/pay(\/.*)?$/, access: { kind: "roles", roles: CUSTOMER } },
  { pattern: /^\/receipts(\/.*)?$/, access: { kind: "roles", roles: CUSTOMER } },
  { pattern: /^\/profile\/(payments|addresses)(\/.*)?$/, access: { kind: "roles", roles: CUSTOMER } },

  // Tradie only. `/jobs` itself is the job board; a job's own page is shared (below).
  { pattern: /^\/jobs$/, access: { kind: "roles", roles: TRADIE } },
  { pattern: /^\/jobs\/[^/]+\/(book|complete|help)$/, access: { kind: "roles", roles: TRADIE } },
  { pattern: /^\/earnings(\/.*)?$/, access: { kind: "roles", roles: TRADIE } },
  { pattern: /^\/quoting(\/.*)?$/, access: { kind: "roles", roles: TRADIE } },
  { pattern: /^\/profile\/(trades|payroll|area|public|crew)(\/.*)?$/, access: { kind: "roles", roles: TRADIE } },

  // Customers and tradies.
  { pattern: /^\/jobs\/[^/]+(\/.*)?$/, access: { kind: "roles", roles: APP_USER } },
  { pattern: /^\/dashboard(\/.*)?$/, access: { kind: "roles", roles: APP_USER } },
  { pattern: /^\/messages(\/.*)?$/, access: { kind: "roles", roles: APP_USER } },
  { pattern: /^\/notifications(\/.*)?$/, access: { kind: "roles", roles: APP_USER } },
  { pattern: /^\/support(\/.*)?$/, access: { kind: "roles", roles: APP_USER } },
  { pattern: /^\/profile(\/.*)?$/, access: { kind: "roles", roles: APP_USER } },
];

/** Trailing slashes don't change the rule: `/admin/` is `/admin`. */
function normalise(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export function routeAccess(pathname: string): RouteAccess {
  const path = normalise(pathname);
  return RULES.find((rule) => rule.pattern.test(path))?.access ?? { kind: "public" };
}

/**
 * Who is asking. `null` = signed out. Someone signed in to Supabase but without a profile row (sign-up was cut
 * off halfway) counts as signed out here; logging in again creates the missing profile.
 */
export type RouteViewer = { role: Role } | null;

export type RouteDecision = { action: "allow" } | { action: "redirect"; to: string };

const ALLOW: RouteDecision = { action: "allow" };

/**
 * What to do with a page visit. `pathWithSearch` is kept in `?next=` when sending someone to log in, so they
 * come back to the same page afterwards.
 */
export function decideRoute(pathname: string, viewer: RouteViewer, pathWithSearch = pathname): RouteDecision {
  const access = routeAccess(pathname);
  switch (access.kind) {
    case "public":
      return ALLOW;
    case "guest":
      return viewer ? { action: "redirect", to: homeForRole(viewer.role) } : ALLOW;
    case "landing":
      return viewer && viewer.role !== "CUSTOMER" ? { action: "redirect", to: homeForRole(viewer.role) } : ALLOW;
    case "roles":
      if (!viewer) return { action: "redirect", to: loginPath(pathWithSearch) };
      return access.roles.includes(viewer.role) ? ALLOW : { action: "redirect", to: homeForRole(viewer.role) };
  }
}

/** `/login?next=…`, or plain `/login` when there's nowhere useful to come back to. */
export function loginPath(next?: string | null): string {
  const safe = safeNextPath(next);
  return safe && safe !== "/" ? `${LOGIN_PATH}?next=${encodeURIComponent(safe)}` : LOGIN_PATH;
}

/**
 * A `?next=` value we're willing to redirect to: a path on this site only. Anything that could leave the site
 * (`https://…`, `//evil.example`, `/\evil.example`, control characters) gives null, so log-in can't be used to
 * bounce people to another website.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (typeof next !== "string" || next.length === 0 || next.length > 2048) return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return null;
  // Resolve against a dummy origin: if the result lands anywhere else, it wasn't a plain path.
  const base = "http://same.invalid";
  try {
    const url = new URL(next, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

/**
 * Where to go after logging in: back to `next` if this role may open it, else the role's home. A tradie who
 * followed a link to a customer-only page lands on the job board instead of being bounced around.
 */
export function afterLoginPath(role: Role, next: string | null | undefined): string {
  const safe = safeNextPath(next);
  if (!safe) return homeForRole(role);
  const pathname = new URL(safe, "http://same.invalid").pathname;
  return decideRoute(pathname, { role }).action === "allow" ? safe : homeForRole(role);
}
