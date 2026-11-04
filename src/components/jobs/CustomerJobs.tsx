"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/Button";
import { JobRow } from "@/components/cards/JobRow";
import { DataTable, TableItem, type Column } from "@/components/data/DataTable";
import { Pagination } from "@/components/data/Pagination";
import { Tabs } from "@/components/data/Tabs";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { OfflineBanner, useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { LoadingRegion } from "@/components/feedback/LoadingRegion";
import { JobRowSkeleton } from "@/components/feedback/Skeleton";
import { TextField } from "@/components/forms/TextFields";
import { StatusPill } from "@/components/status/StatusPill";
import { CATEGORY_INFO } from "@/lib/cards";
import { CUSTOMER_JOBS_PAGE_SIZE, customerJobActionLabel, customerJobsHref, customerListJobHref, type CustomerJobRow, type CustomerJobsData, type CustomerJobsQuery } from "@/lib/customer-jobs";
import styles from "./customer-jobs.module.css";

const LABELS = { active: "Active", done: "Done", cancelled: "Cancelled" };
export function CustomerJobs({ query, data, loading = false, previewOffline = false, basePath }: { query: CustomerJobsQuery; data: CustomerJobsData | null; loading?: boolean; previewOffline?: boolean; basePath?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(query.q), [lastQ, setLastQ] = useState(query.q);
  if (lastQ !== query.q) { setLastQ(query.q); setQ(query.q); }
  const online = useOnlineStatus() && !previewOffline;
  const actualQuery = { ...query, page: data?.page ?? query.page };
  const href = (next: CustomerJobsQuery) => {
    const canonical = customerJobsHref(next);
    if (!basePath) return canonical;
    const [path, search = ""] = basePath.split("?");
    const params = new URLSearchParams(search), selection = new URL(canonical, "https://list.invalid").searchParams;
    for (const key of ["tab", "q", "page"]) { params.delete(key); const value = selection.get(key); if (value) params.set(key, value); }
    return `${path}${params.size ? `?${params}` : ""}`;
  };
  const go = (next: Partial<CustomerJobsQuery>) => {
    if (!online) return;
    startTransition(() => router.push(href({ ...query, page: 1, ...next }), { scroll: false }));
  };
  function search(event: FormEvent<HTMLFormElement>) { event.preventDefault(); go({ q: q.trim().slice(0, 100) }); }
  const columns: Column<CustomerJobRow>[] = [
    { key: "job", header: "Job", primary: true, cell: job => <TableItem title={job.title} meta={`${CATEGORY_INFO[job.category.toLowerCase() as keyof typeof CATEGORY_INFO].name} · TM-${job.jobNumber}`} href={customerListJobHref(job.id, actualQuery)} /> },
    { key: "status", header: "Status", cell: job => <StatusPill status={job.status} audience="customer" context={{ extraWork: job.action === "extra-work" }} /> },
    { key: "tradie", header: "Tradie", optional: true, truncate: true, text: job => job.tradie ?? "None yet", cell: job => job.tradie ?? <span aria-label="None yet">—</span> },
    { key: "price", header: "Price", nowrap: true, cell: job => job.priceCents === null ? <span aria-label="Not priced yet">—</span> : new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(job.priceCents / 100) },
    { key: "updated", header: "Updated", optional: true, cell: job => <time dateTime={job.updatedAt}>{job.updated}</time> },
  ];
  const emptyTitle = query.q ? "No jobs match that." : query.tab === "done" ? "Nothing finished yet." : query.tab === "cancelled" ? "No cancelled jobs." : "Nothing on yet.";
  const error = data === null && !loading ? <ErrorState title="Can’t load your jobs" message="Check your connection and try again." onRetry={() => startTransition(() => router.refresh())} retrying={pending} /> : undefined;
  const empty = <EmptyState illustration={query.tab === "active" && !query.q ? "van" : undefined} icon={query.q ? "search_off" : "inbox"} title={emptyTitle} message={query.q ? "Try fewer filters." : query.tab === "active" ? "Got something that needs doing? Post it free and we’ll get you a price." : undefined} action={query.q ? <Button variant="secondary" width="auto" disabled={!online ? "You’re offline" : false} onClick={() => go({ q: "" })}>Reset filters</Button> : undefined} />;
  const pagination = data && data.total > 0 ? <Pagination page={data.page} pageSize={CUSTOMER_JOBS_PAGE_SIZE} total={data.total} label="My jobs pages" getHref={page => href({ ...query, page })} /> : undefined;
  return <section className={`${styles.page} tm-anim-enter`} data-mode="customer" aria-labelledby="my-jobs-heading">
    <div className={styles.wrap}>
      <div className={styles.heading}><h1 id="my-jobs-heading">My jobs</h1><Button href="/jobs/new" variant={data === null ? "secondary" : "primary"} width="auto" icon="add">Post a job</Button></div>
      <OfflineBanner sticky={false} online={previewOffline ? false : undefined} onRetry={() => router.refresh()} className={styles.notice} />
      <Tabs label="My jobs" value={query.tab} items={(["active", "done", "cancelled"] as const).map(value => ({ value, label: LABELS[value], ...(data ? { count: data.counts[value] } : {}) }))} onChange={tab => go({ tab })}>
        <form onSubmit={search} className={styles.search} role="search" aria-label="Search my jobs"><TextField type="search" icon="search" name="q" label="Search my jobs" labelHidden placeholder="Search my jobs" hint="Title or job number" maxLength={100} value={q} onChange={event => setQ(event.target.value)} className={styles.searchField} /><Button type="submit" variant="secondary" size="sm" width="auto" disabled={!online ? "You’re offline" : false}>Search</Button></form>
        <div className={styles.desktop}><DataTable caption="My jobs" columns={columns} rows={data?.rows ?? []} rowId={job => job.id} rowLabel={job => job.title} rowHref={job => customerListJobHref(job.id, actualQuery)} rowActions={job => <Button href={customerListJobHref(job.id, actualQuery)} variant="secondary" size="sm" width="auto">{customerJobActionLabel(job.action)}</Button>} loading={loading || pending} loadingLabel="Loading your jobs" stickyTop={68} error={error} empty={empty} footer={pagination} /></div>
        <div className={styles.mobile}><LoadingRegion loading={loading || pending} label="Loading your jobs" skeleton={<JobRowSkeleton count={3} />}>
          {error ? <div className={styles.stateCard}>{error}</div> : !data?.rows.length ? <div className={styles.stateCard}>{empty}</div> : <div className={styles.rows}>{data.rows.map(job => <JobRow key={job.id} href={customerListJobHref(job.id, actualQuery)} title={job.title} category={CATEGORY_INFO[job.category.toLowerCase() as keyof typeof CATEGORY_INFO].name} meta={`${job.suburb} · TM-${job.jobNumber}`} status={<StatusPill status={job.status} audience="customer" context={{ extraWork: job.action === "extra-work" }} />} price={job.priceCents === null ? undefined : new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(job.priceCents / 100)} action={<Button href={customerListJobHref(job.id, actualQuery)} variant="secondary" size="sm" width="auto">{customerJobActionLabel(job.action)}</Button>} headingLevel={2} />)}</div>}
        </LoadingRegion>{!loading && !pending && pagination}</div>
      </Tabs>
    </div>
  </section>;
}
