import type { Metadata } from "next";

// Page titles, share settings and "keep out of search" rules (#218, WEBAPP_SPEC G07). Safe on server and browser.

export const SITE_NAME = "Trade Marketplace";

/**
 * The primary domain (DECISIONS.md, #209), used to make share-image links absolute. Vercel preview deployments
 * use their own preview URL instead (Next.js does that by itself).
 */
export const SITE_URL = new URL("https://trademarketplace.nz");

/**
 * Every tab title follows one pattern (mockup `w-meta`): "[Page] · [Job] | Trade Marketplace".
 * Pages set only their own part (`title: pageTitle("Your price", job.title)`); the root layout adds the rest.
 */
export const TITLE_TEMPLATE = `%s | ${SITE_NAME}`;

/** Most unread items shown in the tab before it becomes "99+". */
const MAX_UNREAD = 99;

/** A page's own title part: `pageTitle("Your price", "Sub wiring")` → "Your price · Sub wiring". Blanks are skipped. */
export function pageTitle(...parts: readonly (string | null | undefined)[]): string {
  return parts
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" · ");
}

/**
 * The full tab title, with the unread count in front when there is one:
 * `formatTitle("Messages", 2)` → "(2) Messages | Trade Marketplace". For client code that sets `document.title`
 * when the count changes (the notifications tasks wire it up); server pages use `metadata.title` instead.
 */
export function formatTitle(title?: string | null, unread = 0): string {
  const base = title?.trim() ? TITLE_TEMPLATE.replace("%s", title.trim()) : SITE_NAME;
  const count = Number.isFinite(unread) ? Math.floor(unread) : 0;
  if (count <= 0) return base;
  return `(${count > MAX_UNREAD ? `${MAX_UNREAD}+` : count}) ${base}`;
}

/**
 * Private parts of the app (jobs, account, money, messages, office). Search engines are asked not to crawl them
 * (src/app/robots.ts) and every page under them exports `privateMetadata`. Signed-out visitors (and so crawlers)
 * are sent to log in anyway (src/lib/auth/routes.ts); this keeps the URLs themselves out of search results too.
 */
export const PRIVATE_PATHS: readonly string[] = [
  "/jobs",
  "/dashboard",
  "/profile",
  "/admin",
  "/messages",
  "/notifications",
  "/pay",
  "/receipts",
  "/earnings",
  "/quoting",
  "/support",
];

/**
 * For every private page (PRIVATE_PATHS): not indexed, links not followed, and no share image or Twitter card,
 * even though the root layout has them. Export it from the page or the section's layout:
 *
 *   export const metadata: Metadata = { ...privateMetadata, title: pageTitle("My jobs") };
 */
export const privateMetadata = {
  robots: { index: false, follow: false },
  openGraph: null,
  twitter: null,
} satisfies Metadata;
