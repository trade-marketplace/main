// What the public site header and footer link to (#83). Routes come from docs/design/sitemap.json (A01–A16, B01–B04);
// pages that aren't built yet are linked at their planned route. Safe on server and browser.

import type { Role } from "@/lib/mode";
import { homeForRole, LOGIN_PATH } from "@/lib/auth/routes";

export type SiteLink = { label: string; href: string };

/**
 * The signed-in visitor, as far as the header needs to know: only what it shows. Built on the server from
 * `getViewer()` (`siteViewerOf`), never from anything the browser sends.
 */
export type SiteViewer = { firstName: string; role: Role };

export const POST_JOB_PATH = "/jobs/new";
export const SIGNUP_PATH = "/signup";
export const FOR_TRADIES_PATH = "/for-tradies";

/** The header's nav, in the mockup's order (w-landing). "For tradies" is shown in Amber. */
export const SITE_NAV: readonly SiteLink[] = [
  { label: "How it works", href: "/how-it-works" },
  { label: "For tradies", href: FOR_TRADIES_PATH },
  { label: "Help", href: "/help" },
];

export const LOG_IN: SiteLink = { label: "Log in", href: LOGIN_PATH };
export const SIGN_UP: SiteLink = { label: "Sign up", href: SIGNUP_PATH };

export type FooterColumn = { title: string; links: readonly SiteLink[] };

/**
 * The footer's link columns (mockup w-landing: Customers, Tradies, Company, Legal), covering every public and
 * legal page. The mockup's "Careers" and "Press" have no page in the sitemap, so they're left out until one is
 * planned.
 */
export const FOOTER_COLUMNS: readonly FooterColumn[] = [
  {
    title: "Customers",
    links: [
      { label: "How it works", href: "/how-it-works" },
      { label: "Trust & safety", href: "/trust" },
      { label: "Help centre", href: "/help" },
      { label: "Post a job", href: POST_JOB_PATH },
    ],
  },
  {
    title: "Tradies",
    links: [
      { label: "For tradies", href: FOR_TRADIES_PATH },
      { label: "Tradie terms", href: "/legal/tradie-terms" },
      { label: "Tradie help", href: "/help" },
      { label: "Join", href: "/signup/tradie" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About us", href: "/about" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms", href: "/legal/terms" },
      { label: "Privacy", href: "/legal/privacy" },
      { label: "Cookies", href: "/legal/cookies" },
    ],
  },
];

/** The signed-in header's main button: where this person's app starts (sitemap `navigation`). */
const APP_LINK: Readonly<Record<Role, SiteLink>> = {
  CUSTOMER: { label: "My jobs", href: "/dashboard" },
  TRADIE: { label: "Find work", href: homeForRole("TRADIE") },
  ADMIN: { label: "Office", href: homeForRole("ADMIN") },
};

/** Account settings. The office has no /profile page (its settings live under /admin), so it gets none. */
const ACCOUNT_PATH: Readonly<Record<Role, string | null>> = {
  CUSTOMER: "/profile",
  TRADIE: "/profile",
  ADMIN: null,
};

export type HeaderActions = {
  /** "Post a job", for anyone who can post one: signed-out visitors (it starts the flow) and customers. */
  postJob: SiteLink | null;
  /** Signed out: log in and sign up. */
  guest: { logIn: SiteLink; signUp: SiteLink } | null;
  /** Signed in: their app and their account. */
  app: SiteLink | null;
  account: { name: string; href: string } | null;
};

/** Which actions the header shows for this visitor (null = signed out). */
export function headerActions(viewer: SiteViewer | null): HeaderActions {
  if (!viewer) {
    return { postJob: { label: "Post a job", href: POST_JOB_PATH }, guest: { logIn: LOG_IN, signUp: SIGN_UP }, app: null, account: null };
  }
  const accountPath = ACCOUNT_PATH[viewer.role];
  const name = viewer.firstName.trim() || "Your account";
  return {
    postJob: viewer.role === "CUSTOMER" ? { label: "Post a job", href: POST_JOB_PATH } : null,
    guest: null,
    app: APP_LINK[viewer.role],
    account: accountPath ? { name, href: accountPath } : null,
  };
}

/** True when `href` is the page being shown (or a page under it), for aria-current. */
export function isCurrent(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === href || (href !== "/" && path.startsWith(`${href}/`));
}
