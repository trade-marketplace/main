import type { JobStatus } from "@/generated/prisma/client";
import type { customerJobListView } from "@/server/views/jobs";

export const CUSTOMER_JOBS_PAGE_SIZE = 20;
export const CUSTOMER_JOB_TABS = ["active", "done", "cancelled"] as const;
export type CustomerJobsTab = typeof CUSTOMER_JOB_TABS[number];
export type CustomerJobsQuery = { tab: CustomerJobsTab; q: string; page: number };
export type CustomerJobAction = "price" | "extra-work" | "sign-off" | null;
export type CustomerJobRow = NonNullable<ReturnType<typeof customerJobListView>> & {
  action: CustomerJobAction;
  tradie: string | null;
  updated: string;
};
export type CustomerJobsData = { rows: CustomerJobRow[]; counts: Record<CustomerJobsTab, number>; total: number; page: number };

type Search = URLSearchParams | Record<string, string | string[] | undefined>;
export function parseCustomerJobsQuery(input: Search): CustomerJobsQuery {
  const read = (key: string) => input instanceof URLSearchParams ? input.get(key) : Array.isArray(input[key]) ? input[key]?.[0] : input[key];
  const tab = read("tab"), rawPage = read("page");
  return { tab: tab === "done" || tab === "cancelled" ? tab : "active", q: (read("q") ?? "").trim().slice(0, 100),
    page: rawPage && /^\d{1,6}$/.test(rawPage) && Number(rawPage) > 0 ? Number(rawPage) : 1 };
}
export function customerJobsHref(query: CustomerJobsQuery): string {
  const params = new URLSearchParams();
  if (query.tab !== "active") params.set("tab", query.tab);
  if (query.q) params.set("q", query.q);
  if (query.page > 1) params.set("page", String(query.page));
  return `/dashboard${params.size ? `?${params}` : ""}`;
}
export function customerListJobHref(id: string, query: CustomerJobsQuery): string {
  return `/jobs/${encodeURIComponent(id)}?${new URLSearchParams({ from: customerJobsHref(query) })}`;
}
/** Compatibility for the existing customer detail: accept only this list's bounded query, otherwise Home. */
export function customerJobsReturn(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/dashboard")) return "/";
  try {
    const url = new URL(value, "https://list.invalid");
    return url.origin === "https://list.invalid" && url.pathname === "/dashboard" ? customerJobsHref(parseCustomerJobsQuery(url.searchParams)) : "/";
  } catch { return "/"; }
}
/** Unpriced worker requests, quote bounties and cancellation review are not customer decisions. */
export function customerJobAction(status: JobStatus, pricedVariation: boolean): CustomerJobAction {
  if (status === "PRICED") return "price";
  if (status === "SUBMITTED") return "sign-off";
  return status === "ASSIGNED" && pricedVariation ? "extra-work" : null;
}
export function customerJobActionLabel(action: CustomerJobAction): string {
  return action === "price" ? "See price" : action === "extra-work" ? "View extra work" : action === "sign-off" ? "Check & rate" : "Open";
}
const jobDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" });
export function customerJobUpdated(updatedAt: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(updatedAt)) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const days = Math.round((Date.parse(`${jobDay.format(now)}T00:00:00Z`) - Date.parse(`${jobDay.format(new Date(updatedAt))}T00:00:00Z`)) / 86_400_000);
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
}
