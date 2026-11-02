// The office "All jobs" list (#170, F04, pages.html w-o-jobs): its filters, search, sort and page, and how they
// live in the URL (?status=active&trade=ELECTRICAL&q=tap&sort=price.desc&page=2), so Back, refresh and a shared
// link show the same list, and Export CSV gets exactly what's on screen. Safe on server and browser: no database.
import type { JobStatus, Trade } from "@/generated/prisma/enums";

import { type FilterDefaults, type FilterValues, type SortState } from "./data-table";

export const OFFICE_JOBS_PATH = "/admin/jobs";
export const OFFICE_JOBS_EXPORT_PATH = "/admin/jobs/export";
export const OFFICE_JOBS_PAGE_SIZE = 25;
/** The most rows one CSV export holds. More than that, and the office narrows the filters first. */
export const OFFICE_JOBS_EXPORT_LIMIT = 5000;
/** Longest search we pass to the database. */
export const OFFICE_JOBS_SEARCH_MAX = 80;

type Option = { value: string; label: string };

/** Status groups, in office words (sitemap.json `job_statuses`, office_queue). "all" lists every job. */
export const STATUS_GROUPS = {
  all: { label: "All", statuses: null },
  active: {
    label: "Active",
    statuses: ["REVIEW", "QUOTE_BOUNTY", "PRICED", "BOOKABLE", "ASSIGNED", "SUBMITTED", "CANCEL_REVIEW"],
  },
  price: { label: "To price", statuses: ["REVIEW", "QUOTE_BOUNTY"] },
  customer: { label: "Waiting on customer", statuses: ["PRICED"] },
  unclaimed: { label: "Unclaimed", statuses: ["BOOKABLE"] },
  progress: { label: "In progress", statuses: ["ASSIGNED"] },
  signoff: { label: "Sign-off", statuses: ["SUBMITTED"] },
  done: { label: "Completed", statuses: ["COMPLETED"] },
  cancel: { label: "Cancellations", statuses: ["CANCEL_REVIEW", "CANCELLED"] },
} as const satisfies Record<string, { label: string; statuses: readonly JobStatus[] | null }>;
export type StatusGroup = keyof typeof STATUS_GROUPS;

/** The kinds of work, as the office reads them. */
export const TRADE_LABELS: Record<Trade, string> = {
  ELECTRICAL: "Electrical",
  PLUMBING: "Plumbing",
  GAS: "Gas fitting",
  CONSTRUCTION: "Construction",
  OTHER: "Other",
};

/** How far back "Updated" may go. */
export const DATE_RANGES = {
  all: { label: "Any time", days: null },
  "7d": { label: "Last 7 days", days: 7 },
  "30d": { label: "Last 30 days", days: 30 },
  "90d": { label: "Last 90 days", days: 90 },
} as const satisfies Record<string, { label: string; days: number | null }>;
export type DateRange = keyof typeof DATE_RANGES;

/** The columns the list can be sorted by. Newest change first when nothing is chosen. */
export const SORT_KEYS = ["job", "customer", "tradie", "price", "updated"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export type OfficeJobsQuery = {
  status: StatusGroup;
  trade: Trade | "all";
  /** A city, matched case-insensitively, or "all". */
  region: string;
  date: DateRange;
  q: string;
  sort: SortState;
  page: number;
};

export const OFFICE_JOBS_DEFAULTS: FilterDefaults = { status: "all", trade: "all", region: "all", date: "all" };

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function read(params: Params, key: string): string {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

const has = <T extends string>(record: Record<T, unknown>, value: string): value is T => Object.hasOwn(record, value);

/** The list's state from the URL. Anything unknown or malformed falls back to the default, never an error. */
export function parseOfficeJobsQuery(params: Params): OfficeJobsQuery {
  const status = read(params, "status");
  const trade = read(params, "trade");
  const date = read(params, "date");
  const region = read(params, "region").slice(0, 80);
  const [sortKey, direction] = read(params, "sort").split(".");
  const page = Number(read(params, "page"));
  return {
    status: has(STATUS_GROUPS, status) ? status : "all",
    trade: has(TRADE_LABELS, trade) ? trade : "all",
    region: region && region.toLowerCase() !== "all" ? region : "all",
    date: has(DATE_RANGES, date) ? date : "all",
    q: read(params, "q").slice(0, OFFICE_JOBS_SEARCH_MAX),
    sort:
      (SORT_KEYS as readonly string[]).includes(sortKey) && (direction === "asc" || direction === "desc")
        ? { key: sortKey, direction }
        : null,
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** The filter chips' values (what <FilterBar> shows). */
export function filterValuesOf(query: OfficeJobsQuery): FilterValues {
  return { status: query.status, trade: query.trade, region: query.region, date: query.date };
}

/**
 * The URL search for a list state, writing only what differs from the defaults (so a clean list is a clean URL).
 * `page` 1 is left out. Used for the page's own links, the pager and Export CSV.
 */
export function officeJobsSearch(query: OfficeJobsQuery, { page = query.page }: { page?: number } = {}): string {
  const params = new URLSearchParams();
  for (const key of ["status", "trade", "region", "date"] as const) {
    if (query[key] !== OFFICE_JOBS_DEFAULTS[key]) params.set(key, query[key]);
  }
  if (query.q) params.set("q", query.q);
  if (query.sort) params.set("sort", `${query.sort.key}.${query.sort.direction}`);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `?${search}` : "";
}

/** True when any filter or the search narrows the list (so an empty list means "nothing matches", not "no jobs"). */
export function isFiltered(query: OfficeJobsQuery): boolean {
  return Boolean(query.q) || (["status", "trade", "region", "date"] as const).some((key) => query[key] !== OFFICE_JOBS_DEFAULTS[key]);
}

/** "TM-1005": how every screen and the customer's receipt show a job number. */
export function jobNumberLabel(jobNumber: number): string {
  return `TM-${jobNumber}`;
}

/** A search for a job number ("TM-1005", "tm1005", "1005") gives the number; anything else null. */
export function jobNumberFromSearch(q: string): number | null {
  const match = /^(?:tm-?)?(\d{1,9})$/i.exec(q.trim());
  return match ? Number(match[1]) : null;
}

/** The filter chips: status, trade, region (cities from the server) and date. */
export function officeJobFilters(regions: readonly string[]): { key: string; label: string; defaultValue: string; options: Option[] }[] {
  return [
    {
      key: "status",
      label: "Status",
      defaultValue: "all",
      options: Object.entries(STATUS_GROUPS).map(([value, group]) => ({ value, label: group.label })),
    },
    {
      key: "trade",
      label: "Trade",
      defaultValue: "all",
      options: [{ value: "all", label: "All" }, ...Object.entries(TRADE_LABELS).map(([value, label]) => ({ value, label }))],
    },
    {
      key: "region",
      label: "Region",
      defaultValue: "all",
      options: [{ value: "all", label: "All" }, ...regions.map((city) => ({ value: city, label: city }))],
    },
    {
      key: "date",
      label: "Date",
      defaultValue: "all",
      options: Object.entries(DATE_RANGES).map(([value, range]) => ({ value, label: range.label })),
    },
  ];
}
