// Tables, tabs, pagination and filters (#80): the rules in src/lib/data-table.ts, the HTML each component renders,
// and the CSS rules the design depends on. Keyboard, focus, sticky headers, the card layout and axe are checked
// in the browser: tests/e2e/dev-data.spec.ts.
import { readFileSync } from "node:fs";

import { renderToString as renderHtml } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import DataPage from "@/app/dev/components/data/page";
import { EXAMPLE_JOBS, JOB_FILTERS, OPEN_IDS } from "@/app/dev/components/data/preview-data";
import {
  type Column,
  DataTable,
  defaultsOf,
  FilterBar,
  Pagination,
  QuickFilters,
  SegmentedControl,
  TableItem,
  Tabs,
} from "@/components/data";
import { Menu, MenuItem } from "@/components/overlays";
import {
  activeFilters,
  ariaSort,
  compareValues,
  filtersFromQuery,
  filtersToQuery,
  hasActiveFilters,
  nextSort,
  pageInfo,
  pageSlice,
  sameFilters,
  selectAllState,
  selectedText,
  selectRange,
  showingText,
  sortRows,
  tabKey,
  toggleAll,
  toggleOne,
} from "@/lib/data-table";

// Vitest hashes CSS module class names ("_row_4f0108"); read them back as the names in the CSS file.
const unhash = (text: string) => text.replace(/\b_([A-Za-z-]+)_[0-9a-f]{6}\b/g, "$1");
const renderToString = (node: Parameters<typeof renderHtml>[0]) => unhash(renderHtml(node)).replace(/<!-- -->/g, "");
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("sorting", () => {
  it("a new column sorts its first way; the same column flips", () => {
    expect(nextSort(null, "price")).toEqual({ key: "price", direction: "asc" });
    expect(nextSort(null, "price", "desc")).toEqual({ key: "price", direction: "desc" });
    expect(nextSort({ key: "price", direction: "desc" }, "price")).toEqual({ key: "price", direction: "asc" });
    expect(nextSort({ key: "price", direction: "asc" }, "job", "desc")).toEqual({ key: "job", direction: "desc" });
  });

  it("only the sorted column has aria-sort", () => {
    expect(ariaSort({ key: "price", direction: "asc" }, "price")).toBe("ascending");
    expect(ariaSort({ key: "price", direction: "desc" }, "price")).toBe("descending");
    expect(ariaSort({ key: "price", direction: "asc" }, "job")).toBeUndefined();
    expect(ariaSort(null, "job")).toBeUndefined();
  });

  it("puts empty values last both ways, and compares numbers, dates and words like people do", () => {
    expect(compareValues(null, 5, "asc")).toBeGreaterThan(0);
    expect(compareValues(null, 5, "desc")).toBeGreaterThan(0);
    expect(compareValues("", "a", "desc")).toBeGreaterThan(0);
    expect(compareValues(2, 10, "asc")).toBeLessThan(0);
    expect(compareValues("TM-2", "TM-10", "asc")).toBeLessThan(0); // numeric, not 1 < 2 by character
    expect(compareValues("ōtautahi", "Otautahi", "asc")).toBe(0); // macrons and case don't split a list
    expect(compareValues(new Date(2026, 0, 2), new Date(2026, 0, 1), "desc")).toBeLessThan(0);
  });

  it("sorts a copy, stably, and leaves the order alone with no sort", () => {
    const rows = [
      { id: "a", price: 5 },
      { id: "b", price: null },
      { id: "c", price: 5 },
      { id: "d", price: 1 },
    ];
    const value = (row: (typeof rows)[number]) => row.price;
    expect(sortRows(rows, { key: "price", direction: "asc" }, value).map((r) => r.id)).toEqual(["d", "a", "c", "b"]);
    expect(sortRows(rows, { key: "price", direction: "desc" }, value).map((r) => r.id)).toEqual(["a", "c", "d", "b"]);
    expect(sortRows(rows, null, value)).not.toBe(rows);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("pages", () => {
  it("says where a page sits, and clamps pages past either end", () => {
    expect(pageInfo(1, 25, 128)).toEqual({ page: 1, pageCount: 6, from: 1, to: 25, total: 128, hasPrevious: false, hasNext: true });
    expect(pageInfo(6, 25, 128)).toMatchObject({ from: 126, to: 128, hasNext: false, hasPrevious: true });
    expect(pageInfo(99, 25, 128).page).toBe(6);
    expect(pageInfo(0, 25, 128).page).toBe(1);
    expect(pageInfo(Number.NaN, 25, 128).page).toBe(1);
    expect(pageInfo(1, 25, 0)).toMatchObject({ pageCount: 1, from: 0, to: 0, hasNext: false, hasPrevious: false });
  });

  it("words it like the mockup, with an en dash and thousands", () => {
    expect(showingText(pageInfo(1, 25, 128))).toBe("Showing 1–25 of 128");
    expect(showingText(pageInfo(3, 25, 1284))).toBe("Showing 51–75 of 1,284");
    expect(showingText(pageInfo(2, 1, 2))).toBe("Showing 2 of 2");
    expect(showingText(pageInfo(1, 25, 0))).toBe("No results");
  });

  it("slices out one page", () => {
    const rows = Array.from({ length: 30 }, (_, i) => i);
    expect(pageSlice(rows, 2, 25)).toEqual([25, 26, 27, 28, 29]);
    expect(pageSlice([], 1, 25)).toEqual([]);
  });
});

describe("ticking rows", () => {
  const ids = ["a", "b", "c", "d"];

  it("the header box is all, some or none of this page", () => {
    expect(selectAllState(ids, new Set())).toBe("none");
    expect(selectAllState(ids, new Set(["b", "x"]))).toBe("some");
    expect(selectAllState(ids, new Set(ids))).toBe("all");
    expect(selectAllState([], new Set(["x"]))).toBe("none");
  });

  it("select-all ticks the page, and clears only the page, keeping rows ticked elsewhere", () => {
    expect([...toggleAll(ids, new Set(["x", "a"]))].sort()).toEqual(["a", "b", "c", "d", "x"]);
    expect([...toggleAll(ids, new Set([...ids, "x"]))]).toEqual(["x"]);
  });

  it("Shift+click ticks (or clears) the run from the last click", () => {
    expect([...selectRange(ids, new Set(["a"]), "a", "c")].sort()).toEqual(["a", "b", "c"]);
    expect([...selectRange(ids, new Set(ids), "d", "b")].sort()).toEqual(["a"]);
    expect([...selectRange(ids, new Set(), null, "c")]).toEqual(["c"]); // no last click: just this one
    expect([...toggleOne("a", new Set(["a"]))]).toEqual([]);
    expect(selectedText(1284)).toBe("1,284 selected");
  });
});

describe("filters in the URL", () => {
  const defaults = defaultsOf(JOB_FILTERS);
  const allowed = Object.fromEntries(JOB_FILTERS.map((f) => [f.key, f.options.map((o) => o.value)]));

  it("only non-default filters count as on", () => {
    expect(activeFilters({ ...defaults, status: "price" }, defaults)).toEqual({ status: "price" });
    expect(hasActiveFilters(defaults, defaults)).toBe(false);
    expect(hasActiveFilters({ ...defaults, region: "gore" }, defaults)).toBe(true);
  });

  it("reads known values back from the query, and ignores made-up ones", () => {
    const query = new URLSearchParams("status=price&trade=Lasers&page=2&region=gore");
    expect(filtersFromQuery(query, allowed, defaults)).toEqual({ status: "price", trade: "all", region: "gore", date: "30d" });
  });

  it("writes only non-default values and keeps the rest of the query", () => {
    const next = filtersToQuery(new URLSearchParams("status=done&sort=price.desc"), { ...defaults, region: "bluff" }, defaults);
    expect(next.toString()).toBe("sort=price.desc&region=bluff");
  });

  it("matches a saved filter whatever order or defaults it was stored with", () => {
    expect(sameFilters({ status: "price" }, { ...defaults, status: "price" }, defaults)).toBe(true);
    expect(sameFilters({ status: "price" }, { ...defaults, status: "price", region: "gore" }, defaults)).toBe(false);
  });
});

describe("tab keys", () => {
  it("arrows wrap, Home and End jump, other keys do nothing", () => {
    expect(tabKey("ArrowRight", 2, 3)).toBe(0);
    expect(tabKey("ArrowLeft", 0, 3)).toBe(2);
    expect(tabKey("Home", 2, 3)).toBe(0);
    expect(tabKey("End", 0, 3)).toBe(2);
    expect(tabKey("ArrowDown", 0, 3)).toBeNull();
    expect(tabKey("ArrowRight", 0, 0)).toBeNull();
  });
});

type Job = (typeof EXAMPLE_JOBS)[number];
const COLUMNS: Column<Job>[] = [
  { key: "job", header: "Job", primary: true, sortable: true, cell: (job) => <TableItem title={job.title} meta={job.number} href={`/jobs/${job.id}`} /> },
  { key: "customer", header: "Customer", truncate: true, text: (job) => job.customer, cell: (job) => job.customer },
  { key: "price", header: "Price", sortable: true, firstSort: "desc", optional: true, nowrap: true, cell: (job) => String(job.priceCents) },
];
const table = (props: Partial<Parameters<typeof DataTable<Job>>[0]> = {}) =>
  renderToString(
    <DataTable caption="All jobs" columns={COLUMNS} rows={EXAMPLE_JOBS.slice(0, 3)} rowId={(j) => j.id} rowLabel={(j) => j.title} {...props} />,
  );

describe("<DataTable>", () => {
  it("is a named table with a header row and one row per job", () => {
    const html = table();
    expect(html).toMatch(/<table[^>]*role="table"[^>]*aria-labelledby="([^"]+)"/);
    expect(html).toContain(">All jobs</caption>");
    expect(html.match(/<tr role="row" class="row"/g)).toHaveLength(3);
    expect(html.match(/role="columnheader"/g)).toHaveLength(3);
  });

  it("sortable headers are buttons, and only the sorted one has aria-sort", () => {
    const html = table({ sort: { key: "price", direction: "desc" }, onSortChange: () => {} });
    expect(html).toMatch(/aria-sort="descending"[^>]*><button type="button" class="sortButton" data-sorted="true">Price/);
    expect(html.match(/aria-sort=/g)).toHaveLength(1);
    expect(html).toContain('data-sorted="false">Job');
    // Without onSortChange the header is plain text.
    expect(table()).not.toContain("sortButton");
  });

  it("each cell carries its column name for the phone cards; the title cell doesn't", () => {
    const html = table();
    expect(html).toContain('data-label="Customer"');
    expect(html).not.toContain('data-label="Job"');
    expect(html).toMatch(/data-primary="true"/);
    expect(html).toMatch(/data-optional="true"/);
    expect(html).toMatch(/data-nowrap="true"/);
  });

  it("truncated cells keep the whole value in a tooltip", () => {
    expect(table()).toContain('class="truncate" title="Sarah T"');
  });

  it("tick boxes are named after the row; the bulk bar shows how many are ticked", () => {
    const none = table({ selectable: true, selected: new Set() });
    expect(none).toContain('aria-label="Select Sub wiring"');
    expect(none).toContain('aria-label="Select all rows on this page"');
    expect(none).not.toContain("Bulk actions");
    const two = table({ selectable: true, selected: new Set(["job-1", "job-2"]), bulkActions: <button type="button">Export</button> });
    expect(two).toContain('aria-label="Bulk actions for all jobs"');
    expect(two).toContain("2 selected");
    expect(two).toContain(">Export</button>");
    expect(two.match(/data-checked="true"/g)).toHaveLength(2);
    expect(two).toContain('data-bulk="true"');
  });

  it("the open row is aria-current and clickable rows are marked", () => {
    const html = table({ activeRowId: "job-2", rowHref: (j) => `/jobs/${j.id}` });
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html.match(/data-href="\/jobs\/job-\d"/g)).toHaveLength(3);
    expect(html).toContain('data-row-link="true"');
  });

  it("loading: aria-busy and skeleton rows hidden from screen readers", () => {
    const html = table({ rows: [], loading: true, skeletonRows: 4 });
    expect(html).toContain('aria-busy="true"');
    expect(html.match(/class="row skeletonRow" aria-hidden="true"/g)).toHaveLength(4);
  });

  it("empty and error states take the whole width; an error wins over empty", () => {
    const empty = table({ rows: [], empty: <p>Nothing to price.</p>, rowActions: () => null, selectable: true });
    expect(empty).toMatch(/colSpan="5"|colspan="5"/);
    expect(empty).toContain("Nothing to price.");
    const error = table({ rows: [], empty: <p>Nothing.</p>, error: <p>Can’t load the jobs</p> });
    expect(error).toContain("Can’t load the jobs");
    expect(error).not.toContain("Nothing.");
    // The select-all box can't be used with nothing to select.
    expect(empty).toMatch(/aria-label="Select all rows on this page"[^>]*disabled/);
  });

  it("the footer sits inside the card", () => {
    expect(table({ footer: <Pagination page={1} pageSize={25} total={128} onPageChange={() => {}} /> })).toMatch(
      /data-footer="true"[\s\S]*<div class="footer"><nav aria-label="Pages"/,
    );
  });
});

describe("<Tabs> and <SegmentedControl>", () => {
  const items = [
    { value: "price", label: "To price", count: 4 },
    { value: "extra", label: "Extra work", count: 2 },
  ];

  it("a named tablist, one selected tab in the Tab order, and its panel", () => {
    const html = renderToString(
      <Tabs label="Queues" items={items} value="extra" onChange={() => {}}>
        <p>Extra work panel</p>
      </Tabs>,
    );
    expect(html).toContain('role="tablist" aria-label="Queues"');
    expect(html).toMatch(/aria-selected="false"[^>]*tabindex="-1"[^>]*>To price \(4\)/);
    expect(html).toMatch(/aria-selected="true"[^>]*tabindex="0"[^>]*>Extra work \(2\)/);
    expect(html).toMatch(/role="tabpanel" aria-labelledby="[^"]+-tab-extra" tabindex="0"/);
    expect(html).toContain("data-tab-indicator");
  });

  it("only points aria-controls at a panel that exists", () => {
    expect(renderToString(<Tabs label="Q" items={items} value="price" onChange={() => {}} />)).not.toContain("aria-controls");
    expect(renderToString(<Tabs label="Q" items={items} value="price" onChange={() => {}} controls="list" />)).toContain('aria-controls="list"');
  });

  it("the segmented thumb is placed by index, and icons sit above labels", () => {
    const html = renderToString(
      <SegmentedControl label="View" width="auto" items={[{ value: "grid", label: "Grid", icon: "grid_view" }, { value: "map", label: "Map", icon: "map" }]} value="map" onChange={() => {}} />,
    );
    expect(html).toContain("--seg-count:2;--seg-index:1");
    expect(html).toContain('data-width="auto"');
    expect(html).toMatch(/data-icon="true"/);
  });
});

describe("<Pagination>", () => {
  it("first page: Previous is greyed out but stays; Next is a button", () => {
    const html = renderToString(<Pagination page={1} pageSize={25} total={128} onPageChange={() => {}} label="Jobs" />);
    expect(html).toContain('aria-label="Jobs"');
    expect(html).toContain("Showing <b>1–25</b> of 128");
    expect(html).toMatch(/aria-label="Previous page"[^>]*aria-disabled="true"/);
    expect(html).toMatch(/aria-label="Next page"/);
  });

  it("links when given getHref, so the page is in the URL", () => {
    const html = renderToString(<Pagination page={2} pageSize={25} total={1284} getHref={(p) => `/admin/jobs?page=${p}`} />);
    expect(html).toContain('href="/admin/jobs?page=1"');
    expect(html).toContain('href="/admin/jobs?page=3"');
    expect(html).toContain("of 1,284");
  });

  it("no buttons for one page; “No results” for none", () => {
    expect(renderToString(<Pagination page={1} pageSize={25} total={7} onPageChange={() => {}} />)).not.toContain("Next");
    const none = renderToString(<Pagination page={1} pageSize={25} total={0} onPageChange={() => {}} />);
    expect(none).toContain("No results");
    expect(none).not.toContain("Previous");
  });
});

describe("<FilterBar> and <QuickFilters>", () => {
  const defaults = defaultsOf(JOB_FILTERS);
  const bar = (values: Record<string, string>, q = "") =>
    renderToString(
      <FilterBar
        label="Filter jobs"
        search={{ label: "Search jobs", value: q, onChange: () => {} }}
        filters={JOB_FILTERS}
        values={values}
        onChange={() => {}}
        saved={{ filters: [{ id: "s1", name: "Overdue to price", values: { status: "price" } }], onSave: () => {} }}
      />,
    );

  it("a search landmark with a labelled search box and one chip per filter saying its choice", () => {
    const html = bar(defaults);
    expect(html).toContain('role="search" aria-label="Filter jobs"');
    expect(html).toContain('type="search"');
    expect(html).toContain('aria-label="Search jobs"');
    expect(html).toContain('aria-label="Status: All"');
    expect(html).toContain('aria-label="Date: Last 30 days"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain("data-on");
    expect(html).not.toContain("Clear filters");
    expect(html).not.toContain("Clear search");
  });

  it("a filtering chip is filled, Clear filters appears, and the matching saved filter is named", () => {
    const html = bar({ ...defaults, status: "price" });
    expect(html).toMatch(/aria-label="Status: To price"[\s\S]*?data-on="true"/);
    expect(html).toContain("Clear filters");
    expect(html).toContain('aria-label="Saved filters: Overdue to price"');
  });

  it("a search on its own shows Clear filters and the × in the box", () => {
    const html = bar(defaults, "TM-1003");
    expect(html).toContain("Clear filters");
    expect(html).toContain('aria-label="Clear search"');
  });

  it("quick filters are toggle buttons; the gold one is marked", () => {
    const html = renderToString(
      <QuickFilters label="Show" value="ready" onChange={() => {}} items={[{ value: "ready", label: "Ready to claim", count: 1284 }, { value: "bounty", label: "Bounties", tone: "gold" }]} />,
    );
    expect(html).toContain('<ul aria-label="Show"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>[\s\S]*Ready to claim[\s\S]*1,284/);
    expect(html).toMatch(/aria-pressed="false" data-tone="gold"/);
  });

  it("a menu item with `checked` is a menuitemradio with a tick", () => {
    const html = renderToString(
      <Menu defaultOpen trigger={(p) => <button type="button" {...p}>Status</button>}>
        <MenuItem checked onSelect={() => {}}>All</MenuItem>
        <MenuItem checked={false} onSelect={() => {}}>Active</MenuItem>
        <MenuItem onSelect={() => {}}>Plain</MenuItem>
      </Menu>,
    );
    expect(html).toMatch(/role="menuitemradio" aria-checked="true"[\s\S]*>All<[\s\S]*menuCheck/);
    expect(html).toContain('role="menuitemradio" aria-checked="false"');
    expect(html).toMatch(/role="menuitem" tabindex="-1"[^>]*>(<[^>]*>)*Plain/);
  });
});

describe("the CSS", () => {
  const css = read("src/components/data/data.module.css");

  it("uses tokens only: no hex colours", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("tables become cards below 640px wide, and optional columns step aside up to 960px", () => {
    expect(css).toMatch(/@container table \(max-width: 639px\)/);
    expect(css).toMatch(/@container table \(min-width: 640px\) and \(max-width: 959px\)\s*\{\s*\.table \[data-optional\] \{ display: none; \}/);
  });

  it("the header sticks (under the bulk bar while it shows)", () => {
    expect(css).toMatch(/\.th \{[^}]*position: sticky;[^}]*top: calc\(var\(--tm-table-top, 0px\) \+ var\(--tm-bulk-height, 0px\)\)/);
  });

  it("the segmented thumb slides with M16 timing and stops under reduced motion; the underline is .tm-tab-indicator", () => {
    expect(css).toMatch(/\.segThumb \{[^}]*transition: transform var\(--trade-dur-base\) var\(--trade-ease-in-out\)/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.segThumb \{ transition: none; \}/);
    expect(read("src/components/data/Tabs.tsx")).toContain("tm-tab-indicator");
  });

  it("inputs are never under 16px (phones zoom in otherwise)", () => {
    expect(css).toMatch(/\.searchInput \{[^}]*font-size: var\(--trade-fs-body\)/);
  });
});

describe("/dev/components/data", () => {
  const render = async (params: Record<string, string> = {}) => renderToString(await DataPage({ searchParams: Promise.resolve(params) }));

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a 404 in production builds", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(render()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("has every section, in office mode unless asked", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const html = await render();
    for (const id of ["tables", "states", "tabs", "segmented", "pagination", "filters", "usage"]) expect(html, id).toContain(`id="${id}"`);
    expect(html).toMatch(/^<div[^>]*data-mode="office"/);
    expect(await render({ mode: "trade" })).toMatch(/^<div[^>]*data-mode="trade"/);
    expect(await render({ mode: "purple" })).toMatch(/^<div[^>]*data-mode="office"/);
  });

  it("shows the filters, sort and page it's given in the URL", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const html = await render({ status: "price", sort: "price.desc", page: "1" });
    expect(html).toContain('aria-label="Status: To price"');
    expect(html).toContain('aria-sort="descending"');
  });

  it("opens a menu on load with ?open=, and ignores unknown ids", async () => {
    vi.stubEnv("NODE_ENV", "development");
    for (const id of OPEN_IDS) expect((await render({ open: id })).match(/role="menu"/g), id).toHaveLength(1);
    expect(await render({ open: "nope" })).not.toContain('role="menu"');
  });
});
