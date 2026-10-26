"use client";

import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/Button";
import { DataTable, FilterBar, Pagination, SegmentedControl, Tabs, type FilterSnapshot, type TableColumn, type TableSort } from "@/components/data";
import { LiveMessage } from "@/components/feedback";
import { ChipGroup } from "@/components/forms";
import { Pill } from "@/components/status/Pill";

import { EMPTY_FILTERS, EXAMPLE_SAVED_FILTER, FILTERS, JOBS, LONG_SUBURB, LONG_TITLE, PREVIEW_STATES, readSavedFilters, visibleJobs, type DemoJob, type PreviewState } from "./demo-data";
import styles from "./preview.module.css";

const STORAGE_KEY = "tm-dev-data-filters";
const STORAGE_EVENT = "tm-dev-data-filters-changed";
let memoryFilters: string | null = null;
const readStorage = () => {
  try { return window.localStorage.getItem(STORAGE_KEY) ?? memoryFilters; } catch { return memoryFilters; }
};
const subscribe = (notify: () => void) => {
  window.addEventListener("storage", notify);
  window.addEventListener(STORAGE_EVENT, notify);
  return () => { window.removeEventListener("storage", notify); window.removeEventListener(STORAGE_EVENT, notify); };
};
const writeStorage = (value: string) => {
  memoryFilters = value;
  try { window.localStorage.setItem(STORAGE_KEY, value); } catch { /* The preview still works when browser storage is off. */ }
  window.dispatchEvent(new Event(STORAGE_EVENT));
};
const columns: TableColumn<DemoJob>[] = [
  { key: "title", label: "Job", sortable: true, render: (row) => <><b>{row.title}</b><span className={styles.meta}>{row.id} · {row.trade}</span></> },
  { key: "suburb", label: "Suburb", sortable: true, render: (row) => row.suburb },
  { key: "status", label: "Status", sortable: true, render: (row) => <Pill kind={row.status === "Done" ? "done" : "info"}>{row.status}</Pill> },
];

export function DataDemos({ initialState }: { initialState: PreviewState }) {
  const [state, setState] = useState<PreviewState>(initialState);
  const [filter, setFilter] = useState<FilterSnapshot>(initialState === "filtered" ? { search: "gate", values: { suburb: "Windsor" } } : EMPTY_FILTERS);
  const [tab, setTab] = useState("all");
  const [segment, setSegment] = useState("list");
  const [sort, setSort] = useState<TableSort>({ key: "title", direction: "asc" });
  const [page, setPage] = useState(1);
  const [examplePage, setExamplePage] = useState(16);
  const [pageSize, setPageSize] = useState(25);
  const [selection, setSelection] = useState<string[]>(initialState === "selected" ? ["TM-1004", "TM-1009"] : []);
  const [message, setMessage] = useState("");
  const rawSaved = useSyncExternalStore(subscribe, readStorage, () => null);
  const saved = rawSaved === null ? [EXAMPLE_SAVED_FILTER] : readSavedFilters(rawSaved);
  const disabled = state === "disabled";
  const source = state === "long" ? [{ ...JOBS[0], title: LONG_TITLE, suburb: LONG_SUBURB }] : state === "empty" ? [] : JOBS;
  const rows = visibleJobs(source, filter, tab, sort);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize)));
  const changeFilters = (next: FilterSnapshot) => { setFilter(next); setPage(1); setSelection([]); };

  return <>
    <section className={styles.section} aria-labelledby="states-title">
      <h2 id="states-title">Try every state</h2>
      <ChipGroup name="preview-state" label="Preview state" value={state} options={PREVIEW_STATES.map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))}
        onChange={(value) => {
          setState(value as PreviewState); setPage(1); setFilter(value === "filtered" ? { search: "gate", values: { suburb: "Windsor" } } : EMPTY_FILTERS); setTab("all");
          setSelection(value === "selected" ? ["TM-1004", "TM-1009"] : []); setMessage("");
        }} />
    </section>
    <section id="tabs" className={styles.section} aria-labelledby="tabs-title">
      <h2 id="tabs-title">Tabs & segmented controls</h2>
      <div className={styles.examples}>
        <Tabs label="Tab example" value={tab} onChange={(value) => { setTab(value); setPage(1); setSelection([]); }} items={[
          { value: "all", label: "All jobs", content: "All jobs are shown in the table below." },
          { value: "active", label: "Active", content: "The table shows active jobs." },
          { value: "done", label: "Done", content: "The table shows finished jobs." },
          { value: "unavailable", label: "Coming soon", disabled: true, content: "Not available yet." },
        ]} />
        <SegmentedControl label="View example" value={segment} onChange={setSegment} items={[
          { value: "list", label: "List", content: "List view keeps the detail close by." },
          { value: "summary", label: "Summary", content: `${rows.length} example jobs match your filters.` },
          { value: "unavailable", label: "Coming soon", disabled: true, content: "Not available yet." },
        ]} />
      </div>
    </section>
    <section id="usage" className={styles.section} aria-labelledby="usage-title">
      <div className={styles.sectionHead}><div><p className={styles.eyebrow}>Working example</p><h2 id="usage-title">Jobs at a glance</h2></div>
        <p className={styles.note}>Example jobs · no live data</p></div>
      <p className={styles.note}>Sort a column, pick a few rows, or save a filter set. Saved filters stay in this browser for this preview.</p>
      <FilterBar filters={FILTERS} value={filter} onChange={changeFilters} disabled={disabled || state === "loading"}
        savedFilters={saved} onSave={(name, snapshot) => {
          const next = [...saved.filter((item) => item.name !== name), { ...snapshot, name, id: name }];
          writeStorage(JSON.stringify(next)); setMessage(`Saved filter ${name}.`);
        }} onDeleteSaved={(id) => { writeStorage(JSON.stringify(saved.filter((item) => item.id !== id))); setMessage("Saved filter deleted."); }} />
      <div className={styles.tableSpace}><DataTable caption="Example jobs" rows={rows.slice((currentPage - 1) * pageSize, currentPage * pageSize)} columns={columns}
        rowKey={(row) => row.id} rowLabel={(row) => row.id} sort={sort} onSort={(next) => { setSort(next); setPage(1); }} disabled={disabled}
        loading={state === "loading"} error={state === "error" ? "Check your connection and try again." : undefined}
        onRetry={() => { setState("default"); setMessage("Jobs loaded."); }}
        emptyAction={<Button variant="secondary" onClick={() => { changeFilters(EMPTY_FILTERS); setState("default"); setTab("all"); }}>Reset filters</Button>}
        selection={{ keys: selection, onChange: setSelection, actions: <Button variant="secondary" width="auto" size="sm" disabled={disabled || state === "loading" || state === "error"}
          onClick={() => setMessage(`Opened ${selection.length} selected example jobs.`)}>Open selected jobs</Button> }}
        rowActions={(row) => <Button variant="tertiary" disabled={disabled} aria-label={`Open ${row.id}`} onClick={() => setMessage(`${row.id}: ${row.title} · ${row.suburb}.`)}>Open job</Button>} />
      </div>
      <Pagination total={state === "error" || state === "loading" ? 0 : rows.length} page={currentPage} pageSize={pageSize}
        disabled={disabled || state === "loading" || state === "error"} onPageChange={setPage}
        onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} />
      <p className={styles.result} aria-live="polite" aria-atomic="true">{message}</p>
      <LiveMessage message={state === "empty" ? "No example jobs match that. Try resetting your filters." : null} />
    </section>
    <section id="long" className={styles.section} aria-labelledby="long-title">
      <h2 id="long-title">Long labels & 200% zoom</h2>
      <p className={styles.note}>Full labels wrap so keyboard and screen reader users get the same words. Try the Long state above for job titles and suburbs.</p>
      <Tabs label="Long label example" value="long" onChange={() => {}} items={[
        { value: "long", label: "A very long tab name for jobs in the surrounding Southland neighbourhoods", content: "This selected panel stays usable when the text grows." },
        { value: "disabled", label: "Another very long label for an unavailable section", disabled: true, content: "Unavailable." },
      ]} />
    </section>
    <section className={styles.section} aria-labelledby="pagination-title">
      <h2 id="pagination-title">Pagination states</h2>
      <Pagination label="Many pages example" total={1280} page={examplePage} pageSize={25} onPageChange={setExamplePage} />
      <Pagination label="Single page example" total={3} page={1} pageSize={25} onPageChange={() => {}} />
      <Pagination label="Empty pagination example" total={0} page={1} pageSize={25} onPageChange={() => {}} />
      <Pagination label="Disabled pagination example" total={128} page={1} pageSize={25} disabled onPageChange={() => {}} />
    </section>
    <section className={styles.section} aria-labelledby="source-title">
      <h2 id="source-title">Use the components</h2>
      <p>Keep filters, sort, page and selection in the consuming page. Sort before slicing a page; replace the example rows with the server result.</p>
      <pre className={styles.code} tabIndex={0} aria-label="Component usage example"><code>{`import { DataTable, FilterBar, Pagination, Tabs } from "@/components/data";

<DataTable caption="Jobs" rows={rows} columns={columns}
  rowKey={(job) => job.id} rowLabel={(job) => job.reference}
  sort={sort} onSort={setSort}
  selection={{ keys: selected, onChange: setSelected }}
  rowActions={(job) => <Button href={job.href}>Open job</Button>} />
<Pagination total={total} page={page} pageSize={25}
  onPageChange={setPage} />`}</code></pre>
    </section>
  </>;
}
