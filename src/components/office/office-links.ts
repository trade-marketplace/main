// Office navigation, in sitemap.json navigation.office order (#85).
import { countText } from "@/components/app/app-links";

export type OfficeCountKey = "queues" | "tradies" | "support";
export type OfficeCounts = Readonly<Record<OfficeCountKey, number>>;
export const EMPTY_OFFICE_COUNTS: OfficeCounts = Object.freeze({ queues: 0, tradies: 0, support: 0 });
export type OfficeLinkKey = OfficeCountKey | "jobs" | "customers" | "payouts" | "payments" | "reviews" | "settings";
export type OfficeLink = { key: OfficeLinkKey; label: string; href: string; icon: string; count?: OfficeCountKey };

export const OFFICE_NAV: readonly OfficeLink[] = [
  { key: "queues", label: "Queues", href: "/admin", icon: "inbox", count: "queues" },
  { key: "jobs", label: "All jobs", href: "/admin/jobs", icon: "work" },
  { key: "tradies", label: "Tradies", href: "/admin/tradies", icon: "badge", count: "tradies" },
  { key: "customers", label: "Customers", href: "/admin/customers", icon: "group" },
  { key: "payouts", label: "Payouts", href: "/admin/payouts", icon: "payments" },
  { key: "payments", label: "Payments", href: "/admin/payments", icon: "receipt_long" },
  { key: "reviews", label: "Reviews", href: "/admin/reviews", icon: "star" },
  { key: "support", label: "Support", href: "/admin/support", icon: "support_agent", count: "support" },
  { key: "settings", label: "Settings", href: "/admin/settings", icon: "settings" },
];

const QUEUE_ROUTES = ["/admin/pricing", "/admin/variations", "/admin/disputes", "/admin/signoff"] as const;

/** Queue work (F02/F03/F06/F07/F15) takes precedence over general job details (F05). */
export function currentOfficeLink(pathname: string | null): OfficeLink | null {
  if (!pathname) return null;
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (path === "/admin"
    || QUEUE_ROUTES.some((route) => path === route || path.startsWith(`${route}/`))
    || /^\/admin\/jobs\/[^/]+\/price(?:\/|$)/.test(path)) return OFFICE_NAV[0];
  return OFFICE_NAV.slice(1).find((link) => path === link.href || path.startsWith(`${link.href}/`)) ?? null;
}

export function officeCountLabel(label: string, count: number): string {
  const text = countText(count);
  return text ? `${label}, ${text} waiting` : label;
}

export type OfficeNavPreview = { at: string; base: string; menuOpen?: boolean; accountOpen?: boolean };

export function officeHref(preview: OfficeNavPreview | undefined, href: string): string {
  if (!preview) return href;
  const url = new URL(preview.base, "http://preview.invalid");
  url.searchParams.set("at", href);
  url.searchParams.delete("menu");
  url.searchParams.delete("account");
  return `${url.pathname}${url.search}`;
}
