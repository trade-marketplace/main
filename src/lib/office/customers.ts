import type { SortState } from "@/lib/data-table";
export const CUSTOMER_PAGE_SIZE = 25;
export const CUSTOMER_SORT_KEYS = ["name", "jobs", "lastJob", "joined"] as const;
export const CUSTOMER_STATES = ["list", "sorted", "searching", "no-match", "empty", "page-2", "error", "loading", "offline"] as const;
export type CustomerState = typeof CUSTOMER_STATES[number];
export type CustomersQuery = { q: string; page: number; sort: SortState };
export type OfficeCustomer = { id: string; name: string; email: string; mobile: string | null; suburb: string | null; jobs: number; lastJobAt: string | null; joinedAt: string };
export type CustomersPage = { query: CustomersQuery; rows: OfficeCustomer[]; total: number };
export function parseCustomersQuery(params: Record<string, string | string[] | undefined>): CustomersQuery {
  const one = (key: string) => { const value = params[key]; return (Array.isArray(value) ? value[0] : value)?.trim() ?? ""; };
  const [key, direction] = one("sort").split("."), page = Number(one("page"));
  return { q: one("q").slice(0, 80), page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 1000000) : 1, sort: CUSTOMER_SORT_KEYS.includes(key as typeof CUSTOMER_SORT_KEYS[number]) && (direction === "asc" || direction === "desc") ? { key, direction } : { key: "joined", direction: "desc" } };
}
export function customersHref(query: CustomersQuery, base = "/admin/customers") {
  const params = new URLSearchParams();
  if (base.startsWith("/dev/")) params.set("state", "list");
  if (query.q) params.set("q", query.q);
  if (query.sort && !(query.sort.key === "joined" && query.sort.direction === "desc")) params.set("sort", `${query.sort.key}.${query.sort.direction}`);
  if (query.page > 1) params.set("page", String(query.page));
  return `${base}${params.size ? `?${params}` : ""}`;
}
export const customerJobsHref = (id: string) => `/admin/jobs?customer=${encodeURIComponent(id)}`;
/** NZ callers commonly type the displayed national mobile rather than its stored E.164 form. */
export function customerMobileSearch(q: string): string | null {
  if (!/^[+\d\s().-]+$/.test(q) || !/\d/.test(q)) return null;
  return q.replace(/\D/g, "").replace(/^0/, "64");
}
