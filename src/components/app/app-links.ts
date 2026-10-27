// What the signed-in app's navigation links to (#84). Routes and order come from docs/design/sitemap.json
// (`navigation`) for the computer's top nav and FRONTEND_SPEC §4 for the phone's five-icon bottom bar. Pages that
// aren't built yet are linked at their planned route. Pure: safe on server and browser.

import type { Role } from "@/lib/mode";

/** The people the app shell is for. The office has its own shell (#85). */
export type AppRole = Extract<Role, "CUSTOMER" | "TRADIE">;

export function isAppRole(role: Role): role is AppRole {
  return role === "CUSTOMER" || role === "TRADIE";
}

/** Which unread count a link shows. */
export type CountKey = "messages" | "notifications";

export type AppLink = {
  label: string;
  href: string;
  /** Material Symbols name; filled when the link is the current page. */
  icon: string;
  /** Extra paths that count as this link's section (Earnings lives under Account on a phone). */
  also?: readonly string[];
  /** Only current when the URL has this `view` (the tradie's "All jobs" is /jobs?view=all). */
  view?: string;
  count?: CountKey;
};

export const POST_JOB_PATH = "/jobs/new";
export const NOTIFICATIONS_PATH = "/notifications";
export const ACCOUNT_PATH = "/profile";
export const HELP_PATH = "/help";

/** The computer's top nav (mockups w-c-home and w-t-board), in order. */
export const TOP_NAV: Readonly<Record<AppRole, readonly AppLink[]>> = {
  CUSTOMER: [
    { label: "Home", href: "/", icon: "home" },
    { label: "My jobs", href: "/dashboard", icon: "wallet" },
    { label: "Messages", href: "/messages", icon: "chat_bubble", count: "messages" },
  ],
  TRADIE: [
    { label: "Find work", href: "/jobs", icon: "travel_explore" },
    { label: "My work", href: "/dashboard", icon: "wallet" },
    { label: "Earnings", href: "/earnings", icon: "payments" },
    { label: "Messages", href: "/messages", icon: "chat_bubble", count: "messages" },
  ],
};

/**
 * The phone's bottom bar (screens.html cus-home, tr-home, tr-earnings): five icons, names for screen readers only.
 * The customer's second icon is "Post a job" where the mockup draws a search icon: customers have no search page
 * and their home's search box starts a job anyway (Matt, #84). On a phone Earnings lives under Account.
 */
export const BOTTOM_NAV: Readonly<Record<AppRole, readonly AppLink[]>> = {
  CUSTOMER: [
    { label: "Home", href: "/", icon: "home" },
    { label: "Post a job", href: POST_JOB_PATH, icon: "add_circle" },
    { label: "My jobs", href: "/dashboard", icon: "wallet" },
    { label: "Messages", href: "/messages", icon: "chat_bubble", count: "messages" },
    { label: "Account", href: ACCOUNT_PATH, icon: "person" },
  ],
  TRADIE: [
    { label: "Find work", href: "/jobs", icon: "home" },
    { label: "All jobs", href: "/jobs", icon: "search", view: "all" },
    { label: "My work", href: "/dashboard", icon: "wallet" },
    { label: "Messages", href: "/messages", icon: "chat_bubble", count: "messages" },
    { label: "Account", href: ACCOUNT_PATH, icon: "person", also: ["/earnings", "/quoting"] },
  ],
};

/** The link's real URL (adds `?view=` when it has one). */
export function linkHref(link: AppLink): string {
  return link.view ? `${link.href}?view=${encodeURIComponent(link.view)}` : link.href;
}

function normalise(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

function inSection(path: string, href: string): boolean {
  return path === href || (href !== "/" && path.startsWith(`${href}/`));
}

/**
 * The link for the page being shown, or null (Notifications, Help…). The most specific link wins: on
 * /jobs?view=all that's "All jobs", not "Find work". A job's own page (/jobs/TM-1005) belongs to the list it came
 * from on the tradie's board, and to nothing on the customer's (they reach jobs from Home and My jobs).
 */
export function currentLink(links: readonly AppLink[], pathname: string | null, view: string | null = null): AppLink | null {
  if (!pathname) return null;
  const path = normalise(pathname);
  let best: AppLink | null = null;
  let bestScore = -1;
  for (const link of links) {
    const paths = [link.href, ...(link.also ?? [])];
    // Post a job is its own page: /jobs/new is never "Find work".
    if (link.href !== POST_JOB_PATH && path === POST_JOB_PATH) continue;
    if (!paths.some((href) => inSection(path, href))) continue;
    if (link.view && link.view !== view) continue;
    // Longer paths are more specific; a matching view beats no view.
    const score = Math.max(...paths.filter((href) => inSection(path, href)).map((href) => href.length)) * 2 + (link.view ? 1 : 0);
    if (score > bestScore) {
      best = link;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Full-screen flows (post a job, estimate, extra work, finish job, pay) hide the bottom bar and use Close (×)
 * instead (FRONTEND_SPEC §3, sitemap routes).
 */
export function isFullScreenFlow(pathname: string | null): boolean {
  if (!pathname) return false;
  const path = normalise(pathname);
  return (
    path === POST_JOB_PATH ||
    /^\/jobs\/[^/]+\/(estimate|variation|complete|book)$/.test(path) ||
    /^\/pay(\/|$)/.test(path)
  );
}

/** The badge's text: up to 99, then "99+". Nothing for 0. */
export function countText(count: number | null | undefined): string | null {
  if (!count || count < 1 || !Number.isFinite(count)) return null;
  return count > 99 ? "99+" : String(Math.floor(count));
}

/** How a count is read out with its link's name: "Messages, 3 unread". */
export function countLabel(label: string, count: number | null | undefined): string {
  const text = countText(count);
  return text ? `${label}, ${text} unread` : label;
}

export type AccountMenuItem = { label: string; href: string; icon: string };

/**
 * The avatar menu (mockup w-notifs, WEBAPP_SPEC E02 note 3): Account, Payments, Notification settings, Help, then
 * Log out (Danger). Payments is the customer's (/profile/payments is customer only); a tradie's money is Earnings.
 */
export function accountMenuItems(role: AppRole): readonly AccountMenuItem[] {
  return [
    { label: "Account", href: ACCOUNT_PATH, icon: "person" },
    ...(role === "CUSTOMER" ? [{ label: "Payments", href: "/profile/payments", icon: "credit_card" }] : []),
    { label: "Notification settings", href: "/profile/notifications", icon: "notifications" },
    { label: "Help", href: HELP_PATH, icon: "help" },
  ];
}

/** "Sarah Thompson", or the first name alone when there's no last name. */
export function fullName(firstName: string, lastName?: string | null): string {
  return [firstName, lastName].map((part) => part?.trim()).filter(Boolean).join(" ") || "Your account";
}
