import type { JobStatus } from "@/generated/prisma/enums";

/** One place chooses the customer panel. Follow-up issues fill these panel slots without replacing the frame. */
export const CUSTOMER_JOB_PANELS = {
  REVIEW: { kind: "getting-price", heading: "We’re on it.", message: "Your price is usually ready the same day. We’ll message you.", price: false },
  QUOTE_BOUNTY: { kind: "quick-look", heading: "Needs a quick look", message: null, price: false },
  PRICED: { kind: "price-ready", heading: "Price ready", message: null, price: true },
  BOOKABLE: { kind: "booked", heading: "We’re finding someone", message: "Finding someone local", price: true },
  ASSIGNED: { kind: "confirmed", heading: "Tradie confirmed", message: null, price: true },
  SUBMITTED: { kind: "please-check", heading: "Please check", message: null, price: true },
  COMPLETED: { kind: "completed", heading: "Sorted.", message: null, price: true },
  CANCEL_REVIEW: { kind: "cancel-review", heading: "Cancel requested", message: null, price: true },
  CANCELLED: { kind: "cancelled", heading: "Cancelled", message: "This job was cancelled.", price: true },
} as const satisfies Record<JobStatus, { kind: string; heading: string; message: string | null; price: boolean }>;

/** Customer home/list return paths never enter the worker board's separate return-path policy. */
export function customerJobReturn(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || /[\\\r\n]/.test(value)) return "/";
  try {
    const url = new URL(value, "https://customer.invalid");
    if (url.origin !== "https://customer.invalid") return "/";
    if (url.pathname === "/" && !url.search) return "/";
    if (url.pathname === "/dashboard") {
      const query = new URLSearchParams();
      const tab = url.searchParams.get("tab"), q = url.searchParams.get("q"), page = url.searchParams.get("page");
      if (tab && ["done", "cancelled"].includes(tab)) query.set("tab", tab);
      if (q?.trim()) query.set("q", q.trim().slice(0, 100));
      if (page && /^[1-9]\d{0,5}$/.test(page) && Number(page) > 1) query.set("page", String(Number(page)));
      return `/dashboard${query.size ? `?${query}` : ""}`;
    }
  } catch { /* Use the customer home for invalid or foreign paths. */ }
  return "/";
}

export function customerJobHref(id: string, back: unknown): string {
  return `/jobs/${id}?from=${encodeURIComponent(customerJobReturn(back))}`;
}

/** Time-window entries may return only to this owned job, carrying the bounded customer list context. */
export function customerJobWindowsReturn(id: string, value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || /[\\\r\n]/.test(value)) return "/notifications";
  try {
    const url = new URL(value, "https://customer.invalid");
    if (url.origin !== "https://customer.invalid" || url.pathname !== `/jobs/${id}` || url.hash || [...url.searchParams.keys()].some(key => key !== "from") || url.searchParams.getAll("from").length > 1) return "/notifications";
    return url.searchParams.has("from") ? customerJobHref(id, url.searchParams.get("from")) : `/jobs/${id}`;
  } catch { return "/notifications"; }
}

export const CUSTOMER_JOB_POLL_MS = 15_000;
export function customerJobShouldRefresh(status: JobStatus, online: boolean, visibility: DocumentVisibilityState): boolean {
  return online && visibility === "visible" && status !== "COMPLETED" && status !== "CANCELLED";
}
