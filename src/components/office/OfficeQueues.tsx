"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { DataTable, Pagination, SearchInput, TableItem, Tabs, type Column } from "@/components/data";
import { EmptyState, ErrorState, OfflineBanner, Skeleton, useOnlineStatus } from "@/components/feedback";
import { CountUp } from "@/components/motion/CountUp";
import { StatusPill } from "@/components/status/StatusPill";
import { canFocusQueueSearch, QUEUES, QUEUE_PAGE_SIZE, queueHref, type QueueData, type QueueProblem, type QueueQuery, type QueueRow } from "@/lib/office-queues";
import styles from "./queues.module.css";

export type OfficeQueuesProps = { query: QueueQuery; data: QueueData | null; loading?: boolean; offline?: boolean; basePath?: string; previewState?: string };

export function OfficeQueues({ query, data, loading = false, offline = false, basePath = "/admin", previewState }: OfficeQueuesProps) {
  const router = useRouter(), browserOnline = useOnlineStatus(), online = browserOnline && !offline;
  const [pending, startTransition] = useTransition(), latest = useRef(query), searchRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState(query.q), [lastQuery, setLastQuery] = useState(query.q), typed = useRef(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (lastQuery !== query.q) { setLastQuery(query.q); setQ(query.q); }
  useEffect(() => { latest.current = query; }, [query]);
  const go = (change: Partial<QueueQuery>, replace = false) => {
    if (!online) return;
    latest.current = { ...latest.current, page: 1, ...change };
    const destination = new URL(queueHref(latest.current, {}, basePath), window.location.origin);
    if (previewState) destination.searchParams.set("state", ["search", "search-empty"].includes(previewState) && !latest.current.q ? latest.current.tab : previewState);
    startTransition(() => (replace ? router.replace : router.push)(`${destination.pathname}${destination.search}`, { scroll: false }));
  };
  const selectQueue = (tab: QueueQuery["tab"]) => {
    if (!online) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = null; typed.current = false; setQ("");
    go({ tab, q: "" });
  };
  useEffect(() => {
    if (!typed.current || !online || q.trim() === latest.current.q) return;
    const timer = setTimeout(() => go({ q: q.trim() }, true), 300);
    searchTimer.current = timer;
    return () => { clearTimeout(timer); if (searchTimer.current === timer) searchTimer.current = null; };
    // The callback reads the latest URL state so fast tab/search changes do not restore stale filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, online]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (canFocusQueueSearch(event, event.target instanceof Element ? event.target : null, !!document.querySelector("[role='dialog'], [role='alertdialog'], [role='menu']"))) {
        event.preventDefault(); searchRef.current?.querySelector<HTMLInputElement>("input")?.focus();
      }
    };
    document.addEventListener("keydown", shortcut); return () => document.removeEventListener("keydown", shortcut);
  }, []);
  const busy = loading || pending, selected = QUEUES.find(queue => queue.key === query.tab)!;
  const rowHref = (row: QueueRow) => row.href;
  const columns: Column<QueueRow>[] = [
    { key: "job", header: "Job", primary: true, cell: row => <TableItem title={row.title} meta={`${row.trade} · ${row.number}`} href={online ? row.href : undefined} /> },
    { key: "customer", header: "Customer", cell: row => <TableItem title={row.customer} meta={row.suburb} /> },
    ...(query.q ? [{ key: "status", header: "Status", cell: (row: QueueRow) => <StatusPill status={row.status} audience="office" /> }, { key: "tradie", header: "Tradie", cell: (row: QueueRow) => row.tradie ?? "—" }]
      : query.tab === "price" ? [{ key: "estimates", header: "Estimates", cell: (row: QueueRow) => row.estimates }, { key: "spread", header: "Spread", cell: (row: QueueRow) => row.spread }]
      : query.tab === "extra" ? [{ key: "tradie", header: "Tradie", cell: (row: QueueRow) => row.tradie ?? "—" }, { key: "context", header: "Extra work", cell: (row: QueueRow) => row.context }]
      : query.tab === "cancel" ? [{ key: "tradie", header: "Tradie", cell: (row: QueueRow) => row.tradie ?? "—" }, { key: "context", header: "Reason", cell: (row: QueueRow) => row.context }]
      : query.tab === "signoff" ? [{ key: "tradie", header: "Tradie", cell: (row: QueueRow) => row.tradie ?? "—" }, { key: "context", header: "Auto-release", cell: (row: QueueRow) => row.context }] : []),
    { key: "waiting", header: "Waiting", cell: row => <time dateTime={row.since} className={row.overdue ? styles.overdue : undefined}>{row.waiting}</time> },
  ];
  const problemColumns: Column<QueueProblem>[] = [
    { key: "job", header: "Job", primary: true, cell: row => <TableItem title={row.title} meta={row.number} href={online ? row.href : undefined} /> },
    { key: "topic", header: "Problem", cell: row => row.topic },
    { key: "reported", header: "Waiting", cell: row => <time dateTime={row.since}>{row.reported}</time> },
  ];
  return <div className={styles.page}>
    <OfflineBanner online={offline ? false : undefined} onRetry={() => router.refresh()} sticky={false} />
    <header className={styles.head}>
      <div><h1 className={styles.title}>Today</h1>{data && <p className={styles.subtitle}>{data.date} · {data.things === 1 ? "1 thing needs you" : `${data.things} things need you`}</p>}</div>
      <div ref={searchRef} className={styles.search}><SearchInput label="Search jobs and people" placeholder="Job no., customer, tradie…" value={q} onChange={value => { typed.current = true; setQ(value); }} /><kbd aria-hidden="true">/</kbd></div>
    </header>
    <div className={styles.kpis} role="group" aria-label="Queue totals" aria-busy={busy}>
      {QUEUES.map(queue => { const kpi = data?.kpis[queue.key]; return <button key={queue.key} type="button" className={`tm-lift ${styles.kpi}`} data-overdue={kpi?.overdue || undefined} aria-pressed={!query.q && query.tab === queue.key} aria-disabled={!online || undefined} onClick={() => selectQueue(queue.key)}>
        <span className={styles.label}>{"phoneCardLabel" in queue ? <><span className={styles.desktopLabel}>{queue.label}</span><span className={styles.phoneLabel}>{queue.phoneCardLabel}</span></> : "cardLabel" in queue ? queue.cardLabel : queue.label}</span>
        {kpi ? <CountUp value={kpi.count} runKey={kpi.count} className={styles.number} /> : <Skeleton width="3rem" height="2rem" />}
        <span className={styles.detail}>{kpi?.detail ?? "—"}</span>
      </button>; })}
    </div>
    {data && <nav className={styles.related} aria-label="Other work"><Link href="/admin/jobs?status=customer">Waiting on customer ({data.waitingCustomer})</Link>{data.problemCount > 0 && !query.q && <Link href="#queue-problems">Problems ({data.problemCount})</Link>}</nav>}
    <div aria-disabled={!online || undefined} className={styles.tabset}>
      <Tabs label="Queues" value={query.tab} items={QUEUES.map(queue => ({ value: queue.key, label: queue.label, count: data?.kpis[queue.key].count }))} onChange={selectQueue}>
        <DataTable caption={query.q ? "Search results" : selected.label} columns={columns} rows={data?.rows ?? []} rowId={row => row.id} rowLabel={row => row.title}
          rowHref={online ? rowHref : undefined} loading={busy} loadingLabel="Loading jobs" rowActions={row => online ? <Button href={row.href} variant={row.action === "Price it" ? "primary" : "secondary"} size="sm" width="auto">{row.action}</Button> : <Button variant={row.action === "Price it" ? "primary" : "secondary"} size="sm" width="auto" disabled="You’re offline">{row.action}</Button>}
          error={!data && !loading ? <ErrorState title="Can’t load jobs" onRetry={() => router.refresh()} /> : undefined}
          empty={<EmptyState icon={query.q ? "search_off" : "task_alt"} title={query.q ? "No jobs match that." : "All clear"} action={query.q ? <Button variant="secondary" onClick={() => { typed.current = true; setQ(""); go({ q: "" }); }}>Clear search</Button> : undefined} />}
          footer={data && data.total > QUEUE_PAGE_SIZE ? <Pagination label="Queue jobs" page={data.page} pageSize={QUEUE_PAGE_SIZE} total={data.total} onPageChange={page => go({ page })} /> : undefined} />
      </Tabs>
    </div>
    {data && !query.q && data.problemCount > 0 && <section id="queue-problems" className={styles.problems} aria-labelledby="problems-heading"><h2 id="problems-heading">Problems ({data.problemCount})</h2>
      <DataTable caption="Problems" columns={problemColumns} rows={data.problems} rowId={row => row.id} rowLabel={row => row.title} rowHref={online ? row => row.href : undefined}
        rowActions={row => online ? <Button href={row.href} variant="secondary" size="sm" width="auto">Open</Button> : <Button variant="secondary" size="sm" width="auto" disabled="You’re offline">Open</Button>}
        footer={data.problemCount > QUEUE_PAGE_SIZE ? <Pagination label="Problems" page={data.problemPage} pageSize={QUEUE_PAGE_SIZE} total={data.problemCount} onPageChange={problemPage => go({ problemPage, page: query.page })} /> : undefined} />
    </section>}
  </div>;
}
