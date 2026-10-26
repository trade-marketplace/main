import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { JOBS, LONG_SUBURB, LONG_TITLE, readSavedFilters, visibleJobs } from "@/app/dev/components/data/demo-data";
import { DataTable, FilterBar, Pagination, Tabs } from "@/components/data";
import { pagination } from "@/components/data/page-range";

const noop = () => {};

describe("pagination", () => {
  it("shows the first and final partial page without off-by-one rows", () => {
    expect(pagination(31, 25, 1)).toMatchObject({ page: 1, pages: 2, start: 1, end: 25 });
    expect(pagination(31, 25, 2)).toMatchObject({ page: 2, start: 26, end: 31 });
  });
  it("has a usable empty page and clamps a page after results shrink", () => {
    expect(pagination(0, 25, 4)).toMatchObject({ page: 1, pages: 1, start: 0, end: 0 });
    expect(pagination(2, 25, 4).page).toBe(1);
  });
  it("bounds huge result sets and invalid inputs", () => {
    expect(pagination(1e9, 25, 100).links).toEqual([1, "gap-1", 99, 100, 101, "gap-101", 40000000]);
    expect(pagination(-5, 0, NaN)).toMatchObject({ page: 1, start: 0, end: 0 });
  });
  it("labels current and unavailable pages for assistive technology", () => {
    const html = renderToStaticMarkup(<Pagination total={31} page={1} pageSize={25} onPageChange={noop} />);
    expect(html).toContain('aria-current="page"');
    expect(html).toMatch(/aria-label="Previous page"[^>]*aria-disabled="true"/);
  });
});

describe("controlled table example", () => {
  it("filters every row before sorting and pagination, with stable numeric references", () => {
    const rows = visibleJobs(JOBS, { search: "gate", values: { suburb: "Windsor" } }, "all", { key: "id", direction: "desc" });
    expect(rows.map((row) => row.id)).toEqual(["TM-1031", "TM-1016", "TM-1001"]);
    expect(visibleJobs(JOBS, { search: "", values: {} }, "done", { key: "id", direction: "asc" })).toHaveLength(11);
  });
  it("what if titles, names and suburbs are very long? Keeps the complete accessible text", () => {
    const html = renderToStaticMarkup(<DataTable caption="Jobs" rows={[{ id: "long", title: LONG_TITLE, suburb: LONG_SUBURB }]}
      rowKey={(row) => row.id} rowLabel={(row) => row.id} columns={[
        { key: "title", label: "Job", render: (row) => row.title },
        { key: "suburb", label: "Suburb", render: (row) => row.suburb },
      ]} />);
    expect(html).toContain(LONG_TITLE);
    expect(html).toContain(LONG_SUBURB);
    expect(html).toContain('<caption');
  });
  it("shows loading, empty and retry states instead of stale rows", () => {
    const props = { caption: "Jobs", rows: JOBS, columns: [{ key: "title", label: "Job", render: (row: typeof JOBS[number]) => row.title }], rowKey: (row: typeof JOBS[number]) => row.id, rowLabel: (row: typeof JOBS[number]) => row.id };
    expect(renderToStaticMarkup(<DataTable {...props} loading />)).toContain('aria-busy="true"');
    expect(renderToStaticMarkup(<DataTable {...props} rows={[]} />)).toContain("Nothing to show yet.");
    const error = renderToStaticMarkup(<DataTable {...props} error="Try again." onRetry={noop} />);
    expect(error).toContain("Try again");
    expect(error).not.toContain("Repair the garden gate");
  });
  it("lets non-job pages supply their own empty title and message", () => {
    const html = renderToStaticMarkup(<DataTable caption="Customers" rows={[]} columns={[]}
      rowKey={() => ""} rowLabel={() => ""} emptyTitle="No customers match that."
      emptyMessage={<>Try another <strong>name</strong>.</>} emptyAction={<button>Clear search</button>} />);
    expect(html).toContain("No customers match that.");
    expect(html).toContain("Try another <strong>name</strong>.");
    expect(html).toContain("Clear search");
    expect(html).not.toContain("jobs");
  });
  it("exposes sorting, row actions and bulk selection with names", () => {
    const html = renderToStaticMarkup(<DataTable caption="Jobs" rows={JOBS.slice(0, 2)}
      rowKey={(row) => row.id} rowLabel={(row) => row.id}
      columns={[{ key: "title", label: "Job", sortable: true, render: (row) => row.title }]}
      sort={{ key: "title", direction: "desc" }} onSort={noop}
      selection={{ keys: ["TM-1001"], onChange: noop }} rowActions={(row) => <button>Open {row.id}</button>} />);
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain('aria-checked="mixed"');
    expect(html).toContain("Select all rows on this page");
    expect(html).toContain("Select TM-1001");
    expect(html).toContain("Open TM-1001");
  });
});

describe("tabs and saved filters", () => {
  it("associates panels and tabs and makes only the active tab a tab stop", () => {
    const html = renderToStaticMarkup(<Tabs label="Jobs" value="missing" onChange={noop} items={[
      { value: "off", label: "Unavailable", disabled: true, content: "Hidden" },
      { value: "all", label: LONG_TITLE, content: "All jobs" },
    ]} />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-controls=');
    expect(html).toContain('role="tabpanel"');
    expect(html.match(/tabindex="0"/g)).toHaveLength(3); // active tab + both panels; the inactive panel is hidden
    expect(html).toContain(LONG_TITLE);
  });
  it("restores saved filters and ignores malformed browser storage", () => {
    const snapshot = { id: "Windsor", name: "Windsor", search: "gate", values: { suburb: "Windsor" } };
    expect(readSavedFilters(JSON.stringify([snapshot, null, { ...snapshot, values: [] }]))).toEqual([snapshot]);
    expect(readSavedFilters("not JSON")).toEqual([]);
    expect(readSavedFilters("null")).toEqual([]);
    const html = renderToStaticMarkup(<FilterBar filters={[]} value={snapshot} onChange={noop} savedFilters={[snapshot]} onDeleteSaved={noop} />);
    expect(html).toContain("Delete saved filter Windsor");
    expect(html).toContain("Remove search: gate");
  });
  it("lets each collection name its search field independently of the filter region", () => {
    const html = renderToStaticMarkup(<FilterBar label="Filter customers" searchLabel="Search customers"
      filters={[]} value={{ search: "", values: {} }} onChange={noop} />);
    expect(html).toContain('aria-label="Filter customers"');
    expect(html).toMatch(/<label[^>]*>Search customers<\/label>/);
    expect(html).not.toContain("jobs");
  });
});
