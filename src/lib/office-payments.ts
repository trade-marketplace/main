// The office Payments ledger (#176, F11): its filters, search and page, and how they live in the URL
// (?status=refunded&kind=JOB&date=30d&q=1005&page=2), so Back, refresh and a shared link show the same list and
// Export CSV gets exactly what's on screen. Follows the All jobs list (src/lib/office-jobs.ts). Safe on server and
// browser: no database.
import type { PaymentKind, PaymentStatus } from "@/generated/prisma/enums";
import type { PillKind } from "@/lib/job-status";

import type { FilterDefaults, FilterValues } from "./data-table";

export const OFFICE_PAYMENTS_PATH = "/admin/payments";
export const OFFICE_PAYMENTS_EXPORT_PATH = "/admin/payments/export";
export const OFFICE_PAYMENTS_PAGE_SIZE = 25;
/** The most rows one CSV export holds. More than that, and the office narrows the filters first. */
export const OFFICE_PAYMENTS_EXPORT_LIMIT = 5000;
/** Longest search passed to the database. */
export const OFFICE_PAYMENTS_SEARCH_MAX = 80;

/** Every state of the preview at /dev/components/office-payments. */
export const OFFICE_PAYMENT_STATES = ["list", "filtered", "refund-dialog", "empty", "no-match", "error", "offline", "loading"] as const;
export type OfficePaymentsState = (typeof OFFICE_PAYMENT_STATES)[number];

/** A payment's status, in office words, and its pill colour. */
export const PAYMENT_STATUSES: Record<PaymentStatus, { label: string; kind: PillKind }> = {
  PAID: { label: "Paid", kind: "good" },
  PARTIALLY_REFUNDED: { label: "Part refunded", kind: "info" },
  REFUNDED: { label: "Refunded", kind: "info" },
  PENDING: { label: "Pending", kind: "waiting" },
  FAILED: { label: "Failed", kind: "alert" },
};

/** The Status filter: lower-case words in the URL. */
export const STATUS_FILTERS = {
  all: { label: "All", statuses: null },
  paid: { label: "Paid", statuses: ["PAID"] },
  part: { label: "Part refunded", statuses: ["PARTIALLY_REFUNDED"] },
  refunded: { label: "Refunded", statuses: ["REFUNDED"] },
  pending: { label: "Pending", statuses: ["PENDING"] },
  failed: { label: "Failed", statuses: ["FAILED"] },
} as const satisfies Record<string, { label: string; statuses: readonly PaymentStatus[] | null }>;
export type StatusFilter = keyof typeof STATUS_FILTERS;

/** What the payment was for, as the job admin's refund dialog names it. */
export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = { JOB: "Job", VARIATION: "Extra work", QUICK_LOOK: "Quick look" };

/** Payments that took money: the ones the totals add up. */
export const TAKEN_STATUSES: readonly PaymentStatus[] = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"];
/** Payments the office can still give money back on (the same rule as src/server/payments/refunds.ts). */
export const REFUNDABLE_STATUSES: readonly PaymentStatus[] = ["PAID", "PARTIALLY_REFUNDED"];

/** When it was paid (or, until then, started). Months are New Zealand months. */
export const PAYMENT_DATE_RANGES = {
  all: { label: "Any time" },
  "7d": { label: "Last 7 days" },
  "30d": { label: "Last 30 days" },
  "90d": { label: "Last 90 days" },
  month: { label: "This month" },
  "last-month": { label: "Last month" },
} as const satisfies Record<string, { label: string }>;
export type PaymentDateRange = keyof typeof PAYMENT_DATE_RANGES;

export type OfficePaymentsQuery = {
  status: StatusFilter;
  kind: PaymentKind | "all";
  date: PaymentDateRange;
  /** A job number ("TM-1005", "1005"), or part of the customer's name or email. */
  q: string;
  page: number;
};

export const OFFICE_PAYMENTS_DEFAULTS: FilterDefaults = { status: "all", kind: "all", date: "all" };

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function read(params: Params, key: string): string {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

const has = <T extends string>(record: Record<T, unknown>, value: string): value is T => Object.hasOwn(record, value);

/** The list's state from the URL. Anything unknown or malformed falls back to the default, never an error. */
export function parseOfficePaymentsQuery(params: Params): OfficePaymentsQuery {
  const status = read(params, "status");
  const kind = read(params, "kind");
  const date = read(params, "date");
  const page = Number(read(params, "page"));
  return {
    status: has(STATUS_FILTERS, status) ? status : "all",
    kind: has(PAYMENT_KIND_LABELS, kind) ? kind : "all",
    date: has(PAYMENT_DATE_RANGES, date) ? date : "all",
    q: read(params, "q").slice(0, OFFICE_PAYMENTS_SEARCH_MAX),
    page: Number.isSafeInteger(page) && page > 1 ? page : 1,
  };
}

export function paymentFilterValues(query: OfficePaymentsQuery): FilterValues {
  return { status: query.status, kind: query.kind, date: query.date };
}

/** The URL search for a list state, writing only what differs from the defaults. `page` 1 is left out. */
export function officePaymentsSearch(query: OfficePaymentsQuery, { page = query.page }: { page?: number } = {}): string {
  const params = new URLSearchParams();
  for (const key of ["status", "kind", "date"] as const) if (query[key] !== OFFICE_PAYMENTS_DEFAULTS[key]) params.set(key, query[key]);
  if (query.q) params.set("q", query.q);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `?${search}` : "";
}

/** True when a filter or the search narrows the list (so an empty list means "nothing matches", not "no payments"). */
export function paymentsFiltered(query: OfficePaymentsQuery): boolean {
  return Boolean(query.q) || (["status", "kind", "date"] as const).some((key) => query[key] !== OFFICE_PAYMENTS_DEFAULTS[key]);
}

/** The filter chips: status, kind and date. */
export function officePaymentFilters(): { key: string; label: string; defaultValue: string; options: { value: string; label: string }[] }[] {
  return [
    { key: "status", label: "Status", defaultValue: "all", options: Object.entries(STATUS_FILTERS).map(([value, item]) => ({ value, label: item.label })) },
    {
      key: "kind",
      label: "Kind",
      defaultValue: "all",
      options: [{ value: "all", label: "All" }, ...Object.entries(PAYMENT_KIND_LABELS).map(([value, label]) => ({ value, label }))],
    },
    { key: "date", label: "Date", defaultValue: "all", options: Object.entries(PAYMENT_DATE_RANGES).map(([value, range]) => ({ value, label: range.label })) },
  ];
}

const ZONE = "Pacific/Auckland";

/** Minutes New Zealand is ahead of UTC at that moment (+780 in summer, +720 in winter). */
function zoneOffsetMinutes(at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-NZ", { timeZone: ZONE, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
      .formatToParts(at)
      .map((part) => [part.type, Number(part.value)]),
  );
  const local = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((local - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** Midnight at the start of the 1st of a New Zealand month, `back` months before the one `now` is in. */
function monthStart(now: Date, back: number): Date {
  const [year, month] = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit" }).format(now).split("-").map(Number);
  const midnight = Date.UTC(year, month - 1 - back, 1);
  // The offset at the guess, then again at the answer, so a month that starts across a daylight-saving change is right.
  const first = midnight - zoneOffsetMinutes(new Date(midnight)) * 60_000;
  return new Date(midnight - zoneOffsetMinutes(new Date(first)) * 60_000);
}

/** The range a date filter means at `now`: from (inclusive) and before (exclusive). Null for any time. */
export function paymentDateBounds(range: PaymentDateRange, now: Date): { from: Date; before: Date | null } | null {
  const day = 24 * 60 * 60_000;
  switch (range) {
    case "all":
      return null;
    case "7d":
    case "30d":
    case "90d":
      return { from: new Date(now.getTime() - Number.parseInt(range, 10) * day), before: null };
    case "month":
      return { from: monthStart(now, 0), before: null };
    case "last-month":
      return { from: monthStart(now, 1), before: monthStart(now, 0) };
  }
}

/** "TM-1005", "tm1005" or "1005" gives the number; anything else null. */
export function paymentJobNumber(q: string): number | null {
  const match = /^(?:tm-?)?(\d{1,9})$/i.exec(q.trim());
  return match ? Number(match[1]) : null;
}

/** "$520.00". */
export function paymentMoney(cents: number): string {
  return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", currencyDisplay: "narrowSymbol" }).format(cents / 100);
}

/** "4 Nov 2026", the New Zealand day. */
export function paymentDay(date: string): string {
  return new Intl.DateTimeFormat("en-NZ", { timeZone: ZONE, day: "numeric", month: "short", year: "numeric" }).format(new Date(date));
}
