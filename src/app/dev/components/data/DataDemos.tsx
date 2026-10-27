"use client";
// /dev/components/data: tables, tabs, pagination and filters, live. The big "All jobs" example keeps its filters,
// search, sort and page in the URL like the real office page will (?status=price&sort=price.desc&page=2), so
// Back and refresh work. `?open=<id>` opens a menu on load (OPEN_IDS in preview-data.ts). Nothing is saved;
// names, prices and suburbs are examples.
import { type ReactNode, useMemo, useState } from "react";

import { Button, IconButton } from "@/components/Button";
import {
  type Column,
  DataTable,
  FilterBar,
  type FilterValues,
  Pagination,
  QuickFilters,
  type SavedFilter,
  SegmentedControl,
  type SortState,
  TableItem,
  Tabs,
} from "@/components/data";
import { EmptyState, ErrorState } from "@/components/feedback";
import { Menu, MenuItem, MenuSeparator } from "@/components/overlays";
import { StatusPill } from "@/components/status/StatusPill";
import {
  filtersFromQuery,
  filtersToQuery,
  pageInfo,
  pageSlice,
  type SortValue,
  sortRows,
} from "@/lib/data-table";

import styles from "./data.module.css";
import {
  ago,
  DATE_LIMIT_MINUTES,
  EXAMPLE_JOBS,
  EXAMPLE_SAVED,
  type ExampleJob,
  JOB_FILTERS,
  LONG_JOBS,
  money,
  type OpenId,
  QUEUE_TABS,
  STATUS_GROUPS,
} from "./preview-data";

const PAGE_SIZE = 25;
const PATH = "/dev/components/data";

const DEFAULTS = Object.fromEntries(JOB_FILTERS.map((filter) => [filter.key, filter.defaultValue]));
const ALLOWED = Object.fromEntries(JOB_FILTERS.map((filter) => [filter.key, filter.options.map((option) => option.value)]));

function valueOf(job: ExampleJob, key: string): SortValue {
  switch (key) {
    case "job":
      return job.title;
    case "customer":
      return job.customer;
    case "tradie":
      return job.tradie;
    case "price":
      return job.priceCents;
    case "updated":
      return -job.updatedMinutes; // newest first when descending
    default:
      return null;
  }
}

function jobColumns(href?: (job: ExampleJob) => string, activeId?: string | null): Column<ExampleJob>[] {
  return [
    {
      key: "job",
      header: "Job",
      primary: true,
      sortable: true,
      cell: (job) => (
        <TableItem
          title={job.title}
          meta={`${job.number} · ${job.trade}`}
          image={`/images/examples/${job.image}.jpg`}
          href={href?.(job)}
          current={activeId === job.id}
        />
      ),
    },
    { key: "status", header: "Status", nowrap: true, cell: (job) => <StatusPill status={job.status} audience="office" /> },
    { key: "customer", header: "Customer", sortable: true, truncate: true, text: (job) => job.customer, cell: (job) => job.customer },
    { key: "tradie", header: "Tradie", sortable: true, optional: true, truncate: true, text: (job) => job.tradie ?? "None yet", cell: (job) => job.tradie ?? <span aria-label="None yet">—</span> },
    { key: "price", header: "Price", sortable: true, nowrap: true, firstSort: "desc", sortLabels: ["Lowest first", "Highest first"], cell: (job) => (job.priceCents === null ? <span aria-label="Not priced yet">—</span> : money(job.priceCents)) },
    { key: "updated", header: "Updated", sortable: true, nowrap: true, firstSort: "desc", sortLabels: ["Oldest first", "Newest first"], optional: true, cell: (job) => ago(job.updatedMinutes) },
  ];
}

function RowMenu({ job, defaultOpen = false }: { job: ExampleJob; defaultOpen?: boolean }) {
  return (
    <Menu defaultOpen={defaultOpen} trigger={(props) => <IconButton icon="more_vert" label={`More for ${job.title}`} {...props} />}>
      <MenuItem icon="open_in_new" href={`${PATH}?active=${job.id}`}>
        Open job
      </MenuItem>
      <MenuItem icon="content_copy" onSelect={() => navigator.clipboard?.writeText(job.number).catch(() => {})}>
        Copy job number
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon="cancel" tone="danger" onSelect={() => {}}>
        Cancel job…
      </MenuItem>
    </Menu>
  );
}

function parseSort(value: string | null): SortState {
  const [key, direction] = (value ?? "").split(".");
  if (!["job", "customer", "tradie", "price", "updated"].includes(key) || (direction !== "asc" && direction !== "desc")) return null;
  return { key, direction };
}

function matches(job: ExampleJob, filters: FilterValues, q: string): boolean {
  const group = STATUS_GROUPS[filters.status];
  if (group && !group.includes(job.status)) return false;
  if (filters.trade !== "all" && job.trade !== filters.trade) return false;
  if (filters.region !== "all" && job.region !== filters.region) return false;
  if (job.updatedMinutes > (DATE_LIMIT_MINUTES[filters.date] ?? Number.POSITIVE_INFINITY)) return false;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [job.title, job.number, job.customer, job.tradie ?? "", job.suburb].some((text) => text.toLowerCase().includes(needle));
}

// ---- The office "All jobs" page (w-o-jobs) ------------------------------------------------------------------

export function JobsTableDemo({ query, open }: { query: string; open: OpenId | null }) {
  const initial = new URLSearchParams(query);
  const [filters, setFilters] = useState<FilterValues>(() => filtersFromQuery(initial, ALLOWED, DEFAULTS));
  const [q, setQ] = useState(initial.get("q") ?? "");
  const [sort, setSort] = useState<SortState>(() => parseSort(initial.get("sort")));
  const [page, setPage] = useState(() => Number(initial.get("page")) || 1);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<SavedFilter[]>(EXAMPLE_SAVED);
  const [exported, setExported] = useState("");
  const active = initial.get("active");

  // Keep the URL in step (replace, not push: typing a search shouldn't fill the Back button).
  const sync = (next: { filters?: FilterValues; q?: string; sort?: SortState; page?: number }) => {
    const f = next.filters ?? filters;
    const s = next.sort === undefined ? sort : next.sort;
    const params = filtersToQuery(new URLSearchParams(window.location.search), f, DEFAULTS);
    const text = next.q ?? q;
    if (text.trim()) params.set("q", text);
    else params.delete("q");
    if (s) params.set("sort", `${s.key}.${s.direction}`);
    else params.delete("sort");
    const p = next.page ?? page;
    if (p > 1) params.set("page", String(p));
    else params.delete("page");
    params.delete("open");
    const search = params.toString();
    window.history.replaceState(null, "", `${PATH}${search ? `?${search}` : ""}${window.location.hash}`);
  };

  const rows = useMemo(() => sortRows(EXAMPLE_JOBS.filter((job) => matches(job, filters, q)), sort, valueOf), [filters, q, sort]);
  const info = pageInfo(page, PAGE_SIZE, rows.length);
  const visible = pageSlice(rows, info.page, PAGE_SIZE);
  const href = (job: ExampleJob) => {
    const params = new URLSearchParams(query);
    params.set("active", job.id);
    params.delete("open");
    return `${PATH}?${params.toString()}#tables`;
  };

  const changeFilters = (next: FilterValues) => {
    setFilters(next);
    setPage(1);
    setTicked(new Set());
    sync({ filters: next, page: 1 });
  };

  return (
    <div className={styles.canvas}>
      <div className={styles.pageHead}>
        <h3 className={styles.pageTitle}>All jobs</h3>
        <div className={styles.pageHeadActions}>
          <Button variant="secondary" size="sm" width="auto" icon="download" onClick={() => setExported(`Exported ${rows.length} jobs (pretend).`)}>
            Export CSV
          </Button>
        </div>
      </div>
      <FilterBar
        label="Filter jobs"
        search={{
          label: "Search jobs",
          placeholder: "Search",
          value: q,
          onChange: (text) => {
            setQ(text);
            setPage(1);
            sync({ q: text, page: 1 });
          },
        }}
        filters={JOB_FILTERS}
        values={filters}
        onChange={changeFilters}
        saved={{
          filters: saved,
          onSave: (name) => setSaved((list) => [...list, { id: `saved-${list.length + 1}`, name, values: { ...filters } }]),
        }}
        defaultOpen={open === "status-filter" ? "status" : open === "saved-filters" ? "saved" : undefined}
      />
      <DataTable
        caption="All jobs"
        columns={jobColumns(href, active)}
        rows={visible}
        rowId={(job) => job.id}
        rowLabel={(job) => job.title}
        sort={sort}
        onSortChange={(next) => {
          setSort(next);
          sync({ sort: next });
        }}
        selectable
        selected={ticked}
        onSelectedChange={setTicked}
        bulkActions={
          <Button variant="secondary" size="sm" width="auto" icon="download" onClick={() => setExported(`Exported ${ticked.size} jobs (pretend).`)}>
            Export selected
          </Button>
        }
        rowActions={(job) => <RowMenu job={job} defaultOpen={open === "row-menu" && job.id === visible[0]?.id} />}
        rowHref={href}
        activeRowId={active}
        empty={
          <EmptyState
            icon="search_off"
            title="No jobs match that."
            message="Try fewer filters, or search for a job number."
            action={
              <Button variant="secondary" width="auto" onClick={() => { changeFilters({ ...DEFAULTS }); setQ(""); sync({ filters: { ...DEFAULTS }, q: "", page: 1 }); }}>
                Clear filters
              </Button>
            }
          />
        }
        footer={
          <Pagination
            label="Jobs"
            page={info.page}
            pageSize={PAGE_SIZE}
            total={rows.length}
            onPageChange={(next) => {
              setPage(next);
              setTicked(new Set());
              sync({ page: next });
            }}
          />
        }
      />
      {exported && (
        <p className={styles.status} role="status">
          {exported}
        </p>
      )}
    </div>
  );
}

// ---- Table states --------------------------------------------------------------------------------------------

const SIX = EXAMPLE_JOBS.slice(0, 6);
const THREE = EXAMPLE_JOBS.slice(0, 3);

function StaticTable({
  rows,
  caption,
  ...rest
}: { rows: ExampleJob[]; caption: string } & Partial<Parameters<typeof DataTable<ExampleJob>>[0]>) {
  const [sort, setSort] = useState<SortState>(rest.sort ?? null);
  const [ticked, setTicked] = useState<Set<string>>(new Set(rest.selected ?? []));
  const sorted = useMemo(() => sortRows(rows, sort, valueOf), [rows, sort]);
  return (
    <DataTable
      caption={caption}
      columns={jobColumns()}
      rowId={(job) => job.id}
      rowLabel={(job) => job.title}
      {...rest}
      rows={sorted}
      sort={sort}
      onSortChange={setSort}
      selected={ticked}
      onSelectedChange={setTicked}
    />
  );
}

export function LoadingTable() {
  return <StaticTable caption="Jobs (loading)" rows={[]} loading loadingLabel="Loading jobs" skeletonRows={4} />;
}

export function EmptyTable() {
  return (
    <StaticTable
      caption="Jobs (none yet)"
      rows={[]}
      empty={<EmptyState icon="inbox" title="Nothing to price." message="New jobs show up here as soon as they’re posted." />}
    />
  );
}

export function ErrorTable() {
  const [retries, setRetries] = useState(0);
  return (
    <StaticTable
      caption="Jobs (couldn’t load)"
      rows={[]}
      error={
        <ErrorState
          title="Can’t load the jobs"
          message="Check your connection and try again."
          announce={false}
          reference={retries ? `7F3A-9${retries}` : undefined}
          onRetry={() => new Promise((resolve) => setTimeout(() => resolve(setRetries((n) => n + 1)), 900))}
        />
      }
    />
  );
}

export function LongTextTable() {
  return <StaticTable caption="Jobs with long names" rows={LONG_JOBS} rowActions={(job) => <RowMenu job={job} />} />;
}

export function SelectedTable() {
  return (
    <StaticTable
      caption="Jobs with two ticked"
      rows={SIX}
      selectable
      selected={new Set(["job-2", "job-3"])}
      activeRowId="job-1"
      sort={{ key: "price", direction: "desc" }}
      bulkActions={
        <>
          <Button variant="secondary" size="sm" width="auto" icon="download">
            Export selected
          </Button>
          <Button size="sm" width="auto">
            Price them
          </Button>
        </>
      }
      rowActions={(job) => <RowMenu job={job} />}
    />
  );
}

export function PhoneTable() {
  const [ticked, setTicked] = useState<Set<string>>(new Set(["job-1"]));
  const [sort, setSort] = useState<SortState>({ key: "updated", direction: "desc" });
  const rows = useMemo(() => sortRows(THREE, sort, valueOf), [sort]);
  return (
    <div className={styles.narrow}>
      <DataTable
        caption="Jobs on a phone"
        columns={jobColumns()}
        rows={rows}
        rowId={(job) => job.id}
        rowLabel={(job) => job.title}
        sort={sort}
        onSortChange={setSort}
        selectable
        selected={ticked}
        onSelectedChange={setTicked}
        rowActions={(job) => <RowMenu job={job} />}
        footer={<Pagination page={1} pageSize={3} total={128} onPageChange={() => {}} label="Jobs on a phone" />}
      />
    </div>
  );
}

// ---- Queues: tabs over a table (w-o-queues) -----------------------------------------------------------------

type Queue = (typeof QUEUE_TABS)[number]["value"];

export function QueuesDemo() {
  const [tab, setTab] = useState<Queue>("price");
  const rows = EXAMPLE_JOBS.filter((job) => job.status === "REVIEW").slice(0, 4);
  const columns: Column<ExampleJob>[] = [
    { key: "job", header: "Job", primary: true, cell: (job) => <TableItem title={job.title} meta={`${job.trade} · ${job.number}`} image={`/images/examples/${job.image}.jpg`} /> },
    { key: "customer", header: "Customer", cell: (job) => `${job.customer} · ${job.suburb}` },
    { key: "estimates", header: "Estimates", cell: (job) => (job.number === "TM-1004" ? "1 · site visit asked" : "5") },
    { key: "waiting", header: "Waiting", nowrap: true, cell: (job) => ago(job.updatedMinutes) },
  ];
  return (
    <div className={styles.canvas}>
      <Tabs label="Queues" items={QUEUE_TABS} value={tab} onChange={setTab}>
        {tab === "price" ? (
          <DataTable
            caption="To price"
            columns={columns}
            rows={rows}
            rowId={(job) => job.id}
            rowLabel={(job) => job.title}
            rowActions={(job) => (
              <Button size="sm" width="auto" href={`${PATH}?active=${job.id}`}>
                Price it
              </Button>
            )}
          />
        ) : (
          <DataTable
            caption={QUEUE_TABS.find((item) => item.value === tab)?.label ?? ""}
            columns={columns}
            rows={[]}
            rowId={(job) => job.id}
            rowLabel={(job) => job.title}
            empty={<EmptyState icon="task_alt" title="All clear." message="Nothing waiting in this queue." />}
          />
        )}
      </Tabs>
    </div>
  );
}

// ---- Tabs and segmented controls ------------------------------------------------------------------------------

export function TradieTabs() {
  const [tab, setTab] = useState("check");
  return (
    <Tabs
      label="Tradies"
      className={styles.grow}
      value={tab}
      onChange={setTab}
      items={[
        { value: "check", label: "To check", count: 3 },
        { value: "verified", label: "Verified", count: 41 },
        { value: "paused", label: "Paused", count: 1 },
      ]}
    >
      <p className={styles.panelText}>
        {tab === "check" ? "Licences waiting for a check." : tab === "verified" ? "Everyone who’s been checked." : "Paused tradies, with the reason."}
      </p>
    </Tabs>
  );
}

export function ManyTabs() {
  const [tab, setTab] = useState<Queue>("signoff");
  return (
    <div className={styles.narrow}>
      <Tabs label="Queues on a phone" items={QUEUE_TABS} value={tab} onChange={setTab}>
        <p className={styles.panelText}>{QUEUE_TABS.find((item) => item.value === tab)?.label}: the bar scrolls sideways, never the page.</p>
      </Tabs>
    </div>
  );
}

export function SegmentedDemos() {
  const [jobs, setJobs] = useState("active");
  const [work, setWork] = useState("now");
  const [view, setView] = useState("grid");
  return (
    <>
      <div className={styles.narrow}>
        <SegmentedControl
          label="My jobs"
          value={jobs}
          onChange={setJobs}
          items={[
            { value: "active", label: "Active", count: 3 },
            { value: "done", label: "Done", count: 8 },
          ]}
        >
          <p className={styles.panelText}>{jobs === "active" ? "Jobs on the go." : "Finished jobs and receipts."}</p>
        </SegmentedControl>
      </div>
      <div className={styles.narrow} data-mode="trade">
        <SegmentedControl
          label="My work"
          value={work}
          onChange={setWork}
          items={[
            { value: "now", label: "On now", count: 3 },
            { value: "estimates", label: "Estimates", count: 5 },
            { value: "done", label: "Done" },
          ]}
        />
      </div>
      <SegmentedControl
        label="View"
        width="auto"
        value={view}
        onChange={setView}
        items={[
          { value: "grid", label: "Grid", icon: "grid_view" },
          { value: "map", label: "Map", icon: "map" },
        ]}
      />
    </>
  );
}

export function LongSegmented() {
  const [value, setValue] = useState("a");
  return (
    <div className={styles.narrow}>
      <SegmentedControl
        label="Long labels"
        value={value}
        onChange={setValue}
        items={[
          { value: "a", label: "Waiting on the customer to approve", count: 12 },
          { value: "b", label: "Taumatawhakatangihanga", count: 3 },
        ]}
      />
    </div>
  );
}

// ---- Pagination ------------------------------------------------------------------------------------------------

export function PagerDemo({ page, total, label }: { page: number; total: number; label: string }) {
  const [current, setCurrent] = useState(page);
  return (
    <div className={styles.grow}>
      <Pagination label={label} page={current} pageSize={25} total={total} onPageChange={setCurrent} />
    </div>
  );
}

export function LinkPagerDemo() {
  return (
    <div className={styles.grow}>
      <Pagination label="Linked pages" page={2} pageSize={25} total={1284} getHref={(p) => `${PATH}?pager=${p}#pagination`} />
    </div>
  );
}

// ---- Filters ---------------------------------------------------------------------------------------------------

export function FilterStates({ preset, label, narrow = false }: { preset: FilterValues; label: string; narrow?: boolean }) {
  const [values, setValues] = useState<FilterValues>({ ...DEFAULTS, ...preset });
  const [q, setQ] = useState("");
  return (
    <div className={narrow ? styles.narrow : styles.grow}>
      <FilterBar
        label={label}
        search={{ label: "Search jobs", value: q, onChange: setQ }}
        filters={JOB_FILTERS}
        values={values}
        onChange={setValues}
        saved={{ filters: EXAMPLE_SAVED, onSave: () => {} }}
      />
    </div>
  );
}

export function QuickFilterDemo({ wrap = false }: { wrap?: boolean }) {
  const [value, setValue] = useState("ready");
  return (
    <div className={wrap ? styles.grow : styles.narrow} data-mode="trade">
      <QuickFilters
        label="Show"
        value={value}
        onChange={setValue}
        wrap={wrap}
        items={[
          { value: "ready", label: "Ready to claim", count: 12 },
          { value: "estimate", label: "Needs estimate", count: 9 },
          { value: "bounty", label: "Bounties", count: 2, tone: "gold" },
          { value: "saved", label: "Saved", count: 4 },
          { value: "nearby", label: "Within 5 km", count: 6 },
        ]}
      />
    </div>
  );
}

/** One example: its name and what to notice, then the live thing. */
export function Row({ name, note, children }: { name: string; note?: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowHead}>
        <h3 className={styles.rowName}>{name}</h3>
        {note && <p className={styles.note}>{note}</p>}
      </div>
      <div className={styles.stage}>{children}</div>
    </div>
  );
}
