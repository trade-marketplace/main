// The rules behind tables, tabs, pagination and filters (#80), as plain functions so they can be unit tested
// without a browser. The components are in src/components/data. Safe on server and browser.

export type SortDirection = "asc" | "desc";
export type SortState = { key: string; direction: SortDirection } | null;

/**
 * What a click on a column header does: a new column sorts by its first direction (most columns read best
 * A→Z or smallest first; dates and money usually want newest/biggest first, so the column can start "desc"),
 * the sorted column flips.
 */
export function nextSort(current: SortState, key: string, firstDirection: SortDirection = "asc"): SortState {
  if (!current || current.key !== key) return { key, direction: firstDirection };
  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}

/** aria-sort for a header: only the sorted column says how; the others say nothing (APG sortable table). */
export function ariaSort(current: SortState, key: string): "ascending" | "descending" | undefined {
  if (!current || current.key !== key) return undefined;
  return current.direction === "asc" ? "ascending" : "descending";
}

export type SortValue = string | number | Date | null | undefined;

const collator = new Intl.Collator("en-NZ", { numeric: true, sensitivity: "base" });

/** Compares two cell values. Empty values ("—", no tradie yet) always go last, whichever way it's sorted. */
export function compareValues(a: SortValue, b: SortValue, direction: SortDirection): number {
  const emptyA = a === null || a === undefined || a === "";
  const emptyB = b === null || b === undefined || b === "";
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  const sign = direction === "asc" ? 1 : -1;
  if (a instanceof Date || b instanceof Date) return sign * (Number(a) - Number(b));
  if (typeof a === "number" && typeof b === "number") return sign * (a - b);
  return sign * collator.compare(String(a), String(b));
}

/** A sorted copy (stable: equal rows keep their order). For lists sorted in the browser; big lists sort on the server. */
export function sortRows<Row>(rows: readonly Row[], sort: SortState, valueOf: (row: Row, key: string) => SortValue): Row[] {
  if (!sort) return [...rows];
  return rows
    .map((row, index) => ({ row, index }))
    .sort((x, y) => compareValues(valueOf(x.row, sort.key), valueOf(y.row, sort.key), sort.direction) || x.index - y.index)
    .map(({ row }) => row);
}

export type PageInfo = {
  /** The page actually shown (asked-for pages past the end clamp to the last page). 1-based. */
  page: number;
  pageCount: number;
  /** 1-based positions of the first and last row on the page; both 0 when there are no rows. */
  from: number;
  to: number;
  total: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

/** Where a page sits in the whole list. WEBAPP_SPEC: office tables show 25 per page. */
export function pageInfo(page: number, pageSize: number, total: number): PageInfo {
  const size = Math.max(1, Math.floor(pageSize));
  const count = Math.max(0, Math.floor(total));
  const pageCount = Math.max(1, Math.ceil(count / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const from = count === 0 ? 0 : (current - 1) * size + 1;
  const to = Math.min(current * size, count);
  return { page: current, pageCount, from, to, total: count, hasPrevious: current > 1, hasNext: current < pageCount };
}

const numberFormat = new Intl.NumberFormat("en-NZ");

/** "Showing 1–25 of 128" (an en dash, thousands separated). */
export function showingText(info: PageInfo): string {
  if (info.total === 0) return "No results";
  const range = info.from === info.to ? numberFormat.format(info.from) : `${numberFormat.format(info.from)}–${numberFormat.format(info.to)}`;
  return `Showing ${range} of ${numberFormat.format(info.total)}`;
}

/** The rows of one page, for lists paged in the browser. */
export function pageSlice<Row>(rows: readonly Row[], page: number, pageSize: number): Row[] {
  const info = pageInfo(page, pageSize, rows.length);
  return rows.slice(info.from === 0 ? 0 : info.from - 1, info.to);
}

/** The header checkbox: ticked when every row on the page is selected, a dash when some are. */
export function selectAllState(rowIds: readonly string[], selected: ReadonlySet<string>): "all" | "some" | "none" {
  const count = rowIds.filter((id) => selected.has(id)).length;
  if (count === 0) return "none";
  return count === rowIds.length ? "all" : "some";
}

/** What the header checkbox does: with everything selected it clears the page, otherwise it selects the page. */
export function toggleAll(rowIds: readonly string[], selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  if (selectAllState(rowIds, selected) === "all") rowIds.forEach((id) => next.delete(id));
  else rowIds.forEach((id) => next.add(id));
  return next;
}

export function toggleOne(id: string, selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Shift+click: selects (or clears, matching the clicked row) every row between the last click and this one. */
export function selectRange(
  rowIds: readonly string[],
  selected: ReadonlySet<string>,
  anchor: string | null,
  id: string,
): Set<string> {
  const end = rowIds.indexOf(id);
  const start = anchor === null ? -1 : rowIds.indexOf(anchor);
  if (start < 0 || end < 0) return toggleOne(id, selected);
  const select = !selected.has(id);
  const next = new Set(selected);
  for (const rowId of rowIds.slice(Math.min(start, end), Math.max(start, end) + 1)) {
    if (select) next.add(rowId);
    else next.delete(rowId);
  }
  return next;
}

/** "3 selected" / "1 selected". */
export function selectedText(count: number): string {
  return `${numberFormat.format(count)} selected`;
}

// ---- Filters in the URL -------------------------------------------------------------------------------------
// WEBAPP_SPEC: filters live in the URL so Back, refresh and a shared link all show the same list. Only values that
// differ from the default are written, so a plain list has a plain URL.

export type FilterValues = Record<string, string>;
export type FilterDefaults = Record<string, string>;

/** Only the filters that aren't on their default, i.e. the ones that make the chip "on". */
export function activeFilters(values: FilterValues, defaults: FilterDefaults): FilterValues {
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== "" && value !== defaults[key]));
}

export function hasActiveFilters(values: FilterValues, defaults: FilterDefaults): boolean {
  return Object.keys(activeFilters(values, defaults)).length > 0;
}

/** Reads the filters (only the known keys and allowed values) back out of a query string. Anything else: the default. */
export function filtersFromQuery(
  query: URLSearchParams,
  allowed: Record<string, readonly string[]>,
  defaults: FilterDefaults,
): FilterValues {
  return Object.fromEntries(
    Object.keys(allowed).map((key) => {
      const value = query.get(key);
      return [key, value !== null && allowed[key].includes(value) ? value : (defaults[key] ?? "")];
    }),
  );
}

/** Writes the filters into a copy of the query string: non-default values set, defaults removed, other params kept. */
export function filtersToQuery(query: URLSearchParams, values: FilterValues, defaults: FilterDefaults): URLSearchParams {
  const next = new URLSearchParams(query);
  for (const [key, value] of Object.entries(values)) {
    if (value === "" || value === defaults[key]) next.delete(key);
    else next.set(key, value);
  }
  return next;
}

/** Same filters? Used to tick the saved filter that matches what's on screen. */
export function sameFilters(a: FilterValues, b: FilterValues, defaults: FilterDefaults): boolean {
  const x = activeFilters(a, defaults);
  const y = activeFilters(b, defaults);
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  return [...keys].every((key) => x[key] === y[key]);
}

/** Tabs and segmented controls: arrow keys move and wrap, Home/End jump (WAI-ARIA tabs, automatic activation). */
export function tabKey(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowRight":
      return (index + 1) % count;
    case "ArrowLeft":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
