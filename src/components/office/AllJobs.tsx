"use client";
// The office "All jobs" page (#170, F04, pages.html w-o-jobs): every job in a table, with search, status / trade /
// region / date filters, sort, 25 a page and Export CSV. The server reads the jobs (src/server/office/jobs.ts);
// this only shows them and moves the list's state in the URL, so Back, refresh and a shared link keep the list.
// Docs: docs/components/office-all-jobs.md.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button, buttonClasses } from "@/components/Button";
import { type Column, DataTable, FilterBar, type FilterValues, Pagination, TableItem } from "@/components/data";
import { EmptyState, ErrorState } from "@/components/feedback";
import { Icon } from "@/components/Icon";
import { StatusPill } from "@/components/status/StatusPill";
import {
  filterValuesOf,
  isFiltered,
  OFFICE_JOBS_EXPORT_PATH,
  OFFICE_JOBS_PAGE_SIZE,
  OFFICE_JOBS_PATH,
  officeJobFilters,
  officeJobsSearch,
  type OfficeJobsQuery,
} from "@/lib/office-jobs";
import type { OfficeJobRow, OfficeJobsPage } from "@/server/office/jobs";

import styles from "./all-jobs.module.css";
import dataStyles from "@/components/data/data.module.css";

/** Wait this long after the last key before searching, so typing doesn't send a request per letter. */
export const SEARCH_DELAY_MS = 300;

export type AllJobsProps = {
  query: OfficeJobsQuery;
  /** A page of jobs, or null when they couldn't be read. */
  data: OfficeJobsPage | null;
};

export function money(cents: number): string {
  return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", currencyDisplay: "narrowSymbol" }).format(cents / 100);
}

const COLUMNS: Column<OfficeJobRow>[] = [
  {
    key: "job",
    header: "Job",
    primary: true,
    sortable: true,
    cell: (job) => <TableItem title={job.title} meta={`${job.number} · ${job.trade}`} href={`${OFFICE_JOBS_PATH}/${job.id}`} />,
  },
  { key: "status", header: "Status", nowrap: true, cell: (job) => <StatusPill status={job.status} audience="office" /> },
  { key: "customer", header: "Customer", sortable: true, truncate: true, text: (job) => job.customer, cell: (job) => job.customer },
  {
    key: "tradie",
    header: "Tradie",
    sortable: true,
    optional: true,
    truncate: true,
    text: (job) => job.tradie ?? "None yet",
    cell: (job) => job.tradie ?? <span aria-label="None yet">—</span>,
  },
  {
    key: "price",
    header: "Price",
    sortable: true,
    nowrap: true,
    firstSort: "desc",
    sortLabels: ["Lowest first", "Highest first"],
    cell: (job) => (job.priceCents === null ? <span aria-label="Not priced yet">—</span> : money(job.priceCents)),
  },
  {
    key: "updated",
    header: "Updated",
    sortable: true,
    nowrap: true,
    firstSort: "desc",
    sortLabels: ["Oldest first", "Newest first"],
    optional: true,
    cell: (job) => <time dateTime={job.updatedAt}>{job.updated}</time>,
  },
];

export function AllJobs({ query, data }: AllJobsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(query.q);

  // The latest list state, for navigations started after a delay (the search) or while another is on its way.
  const latest = useRef(query);
  useEffect(() => {
    latest.current = query;
  }, [query]);

  // Each change is written to `latest` straight away, so a second change made before the first page arrives (a
  // status, then a trade) keeps both.
  const go = (next: Partial<OfficeJobsQuery>, { replace = false }: { replace?: boolean } = {}) => {
    latest.current = { ...latest.current, page: 1, ...next };
    const search = officeJobsSearch(latest.current);
    startTransition(() => (replace ? router.replace : router.push)(`${OFFICE_JOBS_PATH}${search}`, { scroll: false }));
  };

  // The search box follows the URL (Back, Clear filters) and searches a moment after the last key.
  const [lastQuery, setLastQuery] = useState(query.q);
  if (query.q !== lastQuery) {
    setLastQuery(query.q);
    setQ(query.q);
  }
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current || q.trim() === latest.current.q) return;
    const timer = setTimeout(() => go({ q: q.trim() }, { replace: true }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
    // Only a change to the box starts a search; `go` reads the latest state itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Skeleton rows while a filter, sort, search or page change is on its way (M15).
  const loading = pending;
  const page = data;
  const regions = page?.regions ?? [];
  // A region in the URL that no job is in any more still shows on its chip.
  const filters = officeJobFilters(query.region !== "all" && !regions.includes(query.region) ? [...regions, query.region] : regions);
  const total = page?.total ?? 0;
  const filtered = isFiltered(query);

  // The bar hands back every chip's value as last shown; only the one that changed is new.
  const shown = filterValuesOf(query);
  const changeFilters = (values: FilterValues) => {
    const changed = Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== shown[key]));
    go(changed as Partial<OfficeJobsQuery>);
  };

  const clearAll = () => {
    typed.current = false;
    setQ("");
    go({ status: "all", trade: "all", region: "all", date: "all", q: "", customer: undefined });
  };

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>All jobs</h1>
        <a
          className={buttonClasses({ variant: "secondary", size: "sm", width: "auto" })}
          href={`${OFFICE_JOBS_EXPORT_PATH}${officeJobsSearch(query, { page: 1 })}`}
          download
          aria-disabled={total === 0 || undefined}
          onClick={(event) => total === 0 && event.preventDefault()}
        >
          <Icon name="download" size="sm" decorative />
          Export CSV
        </a>
      </div>
      <FilterBar
        label="Filter jobs"
        className={styles.filters}
        search={{
          label: "Search jobs",
          placeholder: "Search",
          value: q,
          onChange: (text) => {
            typed.current = true;
            setQ(text);
          },
        }}
        filters={filters}
        values={filterValuesOf(query)}
        onChange={changeFilters}
        onClear={clearAll}
      />
      {query.customer && <div><button type="button" className={dataStyles.chipButton} aria-label={`Remove customer filter: ${page?.customerLabel ?? "—"}`} onClick={() => go({ customer: undefined })}><span className={dataStyles.chip} data-on><span className={dataStyles.chipLabel}>Customer: {page?.customerLabel ?? "—"}</span><Icon name="close" size="sm" decorative className={dataStyles.chipIcon} /></span></button></div>}
      <DataTable
        caption="All jobs"
        columns={COLUMNS}
        rows={page?.rows ?? []}
        rowId={(job) => job.id}
        rowLabel={(job) => job.title}
        rowHref={(job) => `${OFFICE_JOBS_PATH}/${job.id}`}
        sort={query.sort}
        onSortChange={(sort) => go({ sort })}
        loading={loading}
        loadingLabel="Loading jobs"
        error={
          data === null ? (
            <ErrorState
              title="Can’t load jobs"
              message="Check your connection and try again."
              onRetry={() => startTransition(() => router.refresh())}
              retrying={pending}
              headingLevel={2}
            />
          ) : undefined
        }
        empty={
          filtered ? (
            <EmptyState
              icon="search_off"
              title="No jobs match that."
              message="Try fewer filters, or search for a job number."
              action={
                <Button variant="secondary" width="auto" onClick={clearAll}>
                  Clear filters
                </Button>
              }
              headingLevel={2}
            />
          ) : (
            <EmptyState icon="work" title="No jobs yet." headingLevel={2} />
          )
        }
        footer={
          page && total > 0 ? (
            <Pagination
              label="Jobs"
              page={page.page}
              pageSize={OFFICE_JOBS_PAGE_SIZE}
              total={total}
              onPageChange={(next) => {
                latest.current = { ...latest.current, page: next };
                const search = officeJobsSearch(latest.current);
                startTransition(() => router.push(`${OFFICE_JOBS_PATH}${search}`));
              }}
            />
          ) : undefined
        }
      />
    </div>
  );
}
