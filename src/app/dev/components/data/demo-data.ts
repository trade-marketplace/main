import type { FilterDefinition, FilterSnapshot, SavedFilter, TableSort } from "@/components/data";

export const PREVIEW_STATES = ["default", "loading", "empty", "error", "disabled", "selected", "filtered", "long"] as const;
export type PreviewState = typeof PREVIEW_STATES[number];
export type DemoJob = { id: string; title: string; suburb: string; trade: string; status: string };
export const LONG_TITLE = "A very long job title about repairing a weather-worn garden gate and fence at the far end of the property " + "ExtraLongUnbrokenJobTitle".repeat(6);
export const LONG_SUBURB = "Invercargill–Waihōpai and the surrounding Southland neighbourhoods ".repeat(3);
export const JOBS: DemoJob[] = Array.from({ length: 31 }, (_, index) => ({
  id: `TM-${1001 + index}`,
  title: ["Repair the garden gate", "Hang a hallway door", "Move a couch", "Fix a fence", "Put up shelves"][index % 5],
  suburb: ["Windsor", "Richmond", "Waikiwi"][index % 3],
  trade: index % 2 ? "Construction" : "Other (anything)",
  status: index % 3 ? "Active" : "Done",
}));
export const FILTERS: FilterDefinition[] = [
  { key: "trade", label: "Trade", options: [{ value: "Construction", label: "Construction" }, { value: "Other (anything)", label: "Other (anything)" }] },
  { key: "suburb", label: "Suburb", options: ["Windsor", "Richmond", "Waikiwi"].map((value) => ({ value, label: value })) },
];
export const EMPTY_FILTERS: FilterSnapshot = { search: "", values: {} };
export const EXAMPLE_SAVED_FILTER: SavedFilter = { id: "windsor", name: "Windsor jobs", search: "", values: { suburb: "Windsor" } };

/** Filter and sort before taking a page; the same controlled components also accept server-side results. */
export function visibleJobs(rows: readonly DemoJob[], filter: FilterSnapshot, tab: string, sort: TableSort) {
  const search = filter.search.trim().toLocaleLowerCase("en-NZ");
  return rows.filter((row) => (tab === "all" || row.status.toLowerCase() === tab)
    && (!filter.values.trade || filter.values.trade === row.trade)
    && (!filter.values.suburb || filter.values.suburb === row.suburb)
    && [row.id, row.title, row.suburb].some((text) => text.toLocaleLowerCase("en-NZ").includes(search)))
    .sort((a, b) => {
      const key = sort.key as keyof DemoJob;
      const compared = String(a[key] ?? "").localeCompare(String(b[key] ?? ""), "en-NZ", { numeric: true });
      return (sort.direction === "asc" ? compared : -compared) || a.id.localeCompare(b.id);
    });
}

/** Local preview storage contains only these harmless filter strings, never account or job data. */
export function readSavedFilters(raw: string | null): SavedFilter[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedFilter => Boolean(item) && typeof item === "object"
      && typeof item.id === "string" && typeof item.name === "string" && typeof item.search === "string"
      && item.values && typeof item.values === "object" && !Array.isArray(item.values)
      && Object.values(item.values).every((value) => typeof value === "string"));
  } catch { return []; }
}
