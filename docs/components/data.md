# Data: tables, tabs, pagination and filters

Issue #80. Code: `src/components/data` (import from `@/components/data`); the rules behind it (sorting, paging,
ticking rows, filters in the URL) are plain functions in `src/lib/data-table.ts`. Every variant and state, live:
`/dev/components/data` (dev only), office colours by default, `?mode=customer|trade` for the others and
`?open=status-filter|saved-filters|row-menu` to open a menu on load.

| You need | Use | Spec |
|---|---|---|
| An office list: jobs, tradies, payouts, a queue | `<DataTable>` (+ `<TableItem>` for the Job column) | web.css `.w-tablecard`, `.w-table`; pages.html w-o-jobs, w-o-queues |
| Sections of one page: queues, tradie checks | `<Tabs>` | components.css `.tm-tabs`, M16 |
| Two or three views of one list: Active / Done, Grid / Map | `<SegmentedControl>` | components.css `.tm-seg`, M16; screens.html cus-myjobs, tr-mywork |
| "Showing 1–25 of 128", Previous / Next | `<Pagination>` | web.css `.w-pager`; WEBAPP_SPEC: 25 per page |
| Search, filter chips with dropdowns, saved filters | `<FilterBar>` | pages.html w-o-jobs; WEBAPP_SPEC: filters live in the URL |
| One-tap chips across the top of a list | `<QuickFilters>` | screens.html tr-all; WEBAPP_SPEC D03 (Bounty chip is gold) |

The components show and change state; **the page owns it**. A table never sorts, filters or pages by itself, so
the same table works for a list sorted in the browser and one sorted by the database. Keep filters, search, sort,
page and tab in the URL so Back, refresh and a shared link all show the same list (`filtersToQuery` /
`filtersFromQuery`).

## DataTable

```tsx
import { DataTable, Pagination, TableItem, type Column } from "@/components/data";

const columns: Column<Job>[] = [
  { key: "job", header: "Job", primary: true, sortable: true,
    cell: (job) => <TableItem title={job.title} meta={`${job.number} · ${job.trade}`} image={job.thumbUrl} href={`/admin/jobs/${job.id}`} /> },
  { key: "status", header: "Status", nowrap: true, cell: (job) => <StatusPill status={job.status} audience="office" /> },
  { key: "customer", header: "Customer", truncate: true, text: (job) => job.customer, cell: (job) => job.customer },
  { key: "price", header: "Price", sortable: true, firstSort: "desc", nowrap: true, sortLabels: ["Lowest first", "Highest first"], cell: (job) => money(job.priceCents) },
  { key: "updated", header: "Updated", sortable: true, firstSort: "desc", optional: true, cell: (job) => ago(job.updatedAt) },
];

<DataTable
  caption="All jobs"
  columns={columns}
  rows={jobs}
  rowId={(job) => job.id}
  rowLabel={(job) => job.title}
  sort={sort} onSortChange={setSort}
  selectable selected={ticked} onSelectedChange={setTicked}
  bulkActions={<Button variant="secondary" size="sm" width="auto" icon="download">Export selected</Button>}
  rowActions={(job) => <Menu trigger={(p) => <IconButton icon="more_vert" label={`More for ${job.title}`} {...p} />}>…</Menu>}
  rowHref={(job) => `/admin/jobs/${job.id}`}
  activeRowId={openJobId}
  loading={isLoading} error={failed && <ErrorState … />} empty={<EmptyState … />}
  footer={<Pagination page={page} pageSize={25} total={total} getHref={(p) => `?page=${p}`} label="Jobs" />}
  stickyTop={68}
/>
```

- **Columns.** `primary` is the row's title (one per table; on a phone it heads the card). `sortable` adds a header
  button; `firstSort: "desc"` for money and dates. `truncate` keeps one line with "…" and the whole value in a
  tooltip (give `text`); `nowrap` for pills, money and dates; everything else wraps. `optional` columns step aside
  between 640 and 960px wide. `align: "end"` for numbers compared down a column.
- **Sorting.** Click (or Enter on) a header: the first click sorts the column's first way, the next flips it. Only
  the sorted column has `aria-sort`. Empty values ("—", no tradie yet) go last both ways (`sortRows`,
  `compareValues`).
- **Ticking rows.** A box per row ("Select Sub wiring") and a select-all for the page (a dash when some are
  ticked). Shift+click ticks a run. Ticked rows get the mode tint and a bar on top: "3 selected", your
  `bulkActions`, Clear selection. Clear the selection when the page or filters change.
- **Opening a row.** With `rowHref`, a click anywhere on the row (not on a button, box or link) opens it, using the
  `<TableItem href>` link so keyboard and screen reader users have the same way in. The open one (`activeRowId`)
  is tinted and `aria-current`: the mockup's selected row.
- **Sticky header.** The header row sticks while the list scrolls; `stickyTop` is the height of a sticky bar above
  (68px under the desktop app nav). While the bulk bar shows, the header sticks under it.
- **States.** `loading`: skeleton rows the shape of the real ones after 300ms (M15), `aria-busy`, and "Loading all
  jobs" said once. `error` (an `<ErrorState>`) and `empty` (an `<EmptyState>`) replace the rows, headers kept.
- **On a phone.** Below 640px wide (the table's own width, so a narrow side panel counts too) each row is a card:
  title on top, then each column's name beside its value. Select all and a **Sort** menu (the same choices as the
  headers, worded by `sortLabels`) sit above the cards.

## Tabs and SegmentedControl

```tsx
<Tabs label="Queues" value={tab} onChange={setTab}
  items={[{ value: "price", label: "To price", count: 4 }, { value: "extra", label: "Extra work", count: 2 }]}>
  <QueueTable queue={tab} />
</Tabs>

<SegmentedControl label="My jobs" value={view} onChange={setView}
  items={[{ value: "active", label: "Active", count: 3 }, { value: "done", label: "Done", count: 8 }]} />
<SegmentedControl label="View" width="auto" value={view} onChange={setView}
  items={[{ value: "grid", label: "Grid", icon: "grid_view" }, { value: "map", label: "Map", icon: "map" }]} />
```

- WAI-ARIA tabs with automatic activation: Left/Right move and choose (wrapping), Home/End jump, Tab goes into
  the panel. Counts read as part of the name: "To price (4)".
- **M16:** the 3px underline (or the segmented control's white thumb) slides and resizes to the chosen tab, 200ms
  ease-in-out; it jumps under reduced motion and doesn't slide in on first paint.
- Too many tabs for a phone: the bar scrolls sideways by itself (never the page) and the chosen tab is scrolled
  into view.
- Children are the panel. When the tabs drive something elsewhere, leave children out and pass `controls` (the
  id of what they control).

## Pagination

```tsx
<Pagination label="Jobs" page={page} pageSize={25} total={128} getHref={(p) => `/admin/jobs?page=${p}`} />
<Pagination label="Jobs" page={page} pageSize={25} total={128} onPageChange={setPage} />
```

"Showing 1–25 of 128" (read out when it changes) and Previous / Next. Prefer `getHref` (links) so the page is in
the URL. At either end the button is greyed out, not removed, so the layout doesn't jump. One page: no buttons.
Nothing: "No results". A page past the end shows the last page (`pageInfo`).

## FilterBar and QuickFilters

```tsx
<FilterBar
  label="Filter jobs"
  search={{ label: "Search jobs", placeholder: "Search", value: q, onChange: setQ }}
  filters={[{ key: "status", label: "Status", defaultValue: "all", options: [{ value: "all", label: "All" }, …] }, …]}
  values={filters}
  onChange={setFilters}
  saved={{ filters: savedFilters, onSave: (name) => saveFilters(name, filters) }}
/>

<QuickFilters label="Show" value={show} onChange={setShow}
  items={[{ value: "ready", label: "Ready to claim", count: 12 }, { value: "bounty", label: "Bounties", count: 2, tone: "gold" }]} />
```

- Each filter is a chip that reads "Status: Active" and opens a menu of its choices (the current one ticked;
  `MenuItem checked`). A chip is filled when it isn't on its default. **Clear filters** shows once anything,
  search included, is filtering; it puts every chip back and empties the search.
- The search box has a × (and Esc) to clear it, and is never under 16px so phones don't zoom.
- **Saved filters:** the chip lists your saved sets (the one on screen ticked, and named on the chip) and "Save
  these filters…", which asks for a name (required, under 40 letters, not a name you already have). Where they're
  stored (per office user) is the page's job; this issue has no table for them yet.
- On a phone the search takes the full width and the chips wrap under it.
- `QuickFilters`: one on at a time (`aria-pressed`), live counts, scroll sideways on a phone (`wrap` lets them wrap
  from 600px). Only bounties are gold.

## Tests

- `tests/unit/data-components.test.tsx`: the rules in `src/lib/data-table.ts`, the HTML each component renders
  (roles, names, states) and the CSS the design depends on (tokens only, card layout, sticky header, M16).
- `tests/e2e/dev-data.spec.ts`: axe and no sideways scroll at 320 / 390 / 768 / 1024 / 1440 in all three modes;
  sorting, ticking (Shift+click, select-all), filter menus by keyboard, URL state, search, saving filters,
  pagination, opening a row, tab keys and the M16 underline, the phone cards, 200% zoom and reduced motion. It runs
  against `npm run dev`: `E2E_DEV_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/dev-data.spec.ts`.

## Notes for review

- **Status labels** come from `src/lib/job-status.ts` (sitemap.json), so the demo shows "In progress" and
  "Payroll" where the w-o-jobs mockup says "Assigned" and "Completed".
- **Saved filters** have no mockup. They use the filter chip and the kit's menu and dialog; the copy ("Save these
  filters…", "They’ll be under Saved filters, just for you.") needs Matt's eye.
- **Phone cards** have no office mockup either (WEBAPP_SPEC only says tables become cards); they follow the
  customer job cards' spacing.
- The header row is 41px rather than the mockup's 39px, to fit the 22px tick box; rows are the mockup's 67px.
- Example thumbnails in `public/images/examples` are 96px copies of photos already in `docs/design/img`.
