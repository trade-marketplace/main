"use client";

import { useId, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { TextLink } from "@/components/TextLink";
import { Tabs, SegmentedControl } from "@/components/data/Tabs";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingRegion } from "@/components/feedback/LoadingRegion";
import { OfflineBanner } from "@/components/feedback/OfflineBanner";
import { Skeleton } from "@/components/feedback/Skeleton";
import { MY_WORK_COLUMNS, MY_WORK_LABELS, myWorkHref, type MyQuotesData, type MyWorkColumn, type MyWorkData, type MyWorkQuery } from "@/lib/my-work";
import { MyQuotes } from "./MyQuotes";
import { MyWorkCard } from "./MyWorkCard";
import styles from "./my-work.module.css";

type Props = { query: MyWorkQuery; work: MyWorkData | null; quotes: MyQuotesData | null; loading?: boolean; previewOffline?: boolean; basePath?: string; now?: string; onRetry?: () => void };
export function MyWork({ query, work, quotes, loading = false, previewOffline = false, basePath, now, onRetry }: Props) {
  const id = useId(), router = useRouter(), [pending, startTransition] = useTransition();
  const retry = onRetry ?? (() => startTransition(() => router.refresh()));
  const go = (next: MyWorkQuery) => {
    let destination = myWorkHref(next);
    if (basePath) {
      const [path, search = ""] = basePath.split("?");
      const params = new URLSearchParams(search); params.set("tab", next.tab); params.set("column", next.column);
      destination = `${path}?${params}`;
    }
    startTransition(() => router.push(destination, { scroll: false }));
  };
  const error = !loading && (query.tab === "jobs" ? work === null : quotes === null);
  return <section className={styles.page} aria-labelledby={`${id}-heading`} data-mode="trade"><div className={styles.wrap}>
    <div className={styles.head}><h1 id={`${id}-heading`}>My work</h1>
      {work ? <p>{work.jobsOn} {work.jobsOn === 1 ? "job" : "jobs"} on</p> : loading ? <Skeleton width={100} height={20} /> : null}
    </div>
    <Tabs label="My work" value={query.tab} items={[{ value: "jobs", label: "Jobs" }, { value: "quotes", label: "Quotes", ...(quotes ? { count: quotes.total } : {}) }]}
      onChange={tab => go({ ...query, tab })} className={styles.tabs}>
      <OfflineBanner sticky={false} online={previewOffline ? false : undefined} onRetry={retry} className={styles.notice} />
      <LoadingRegion loading={loading} label="Loading your work" skeleton={<div className={styles.board}>{MY_WORK_COLUMNS.map(column => <div className={styles.column} key={column}><Skeleton width="60%" height={20} /><Skeleton height={130} /></div>)}</div>}>
        <div aria-busy={pending || undefined}>
          {error ? <div className={styles.state}><ErrorState title="Couldn’t load your work." onRetry={retry} retrying={pending} /></div>
            : query.tab === "quotes" && quotes ? <MyQuotes data={quotes} query={query} />
              : work && MY_WORK_COLUMNS.every(column => work.counts[column] === 0) ? <div className={styles.state}><EmptyState title="No jobs yet." illustration="van" action={<Button href="/jobs">Find work</Button>} /></div>
                : work ? <>
                  <div className={styles.desktop}><div className={styles.board}>{MY_WORK_COLUMNS.map(column => <WorkColumn key={column} column={column} work={work} query={query} now={now} />)}</div></div>
                  <div className={styles.mobile}><SegmentedControl label="Work columns" value={query.column} items={MY_WORK_COLUMNS.map(value => ({ value, label: MY_WORK_LABELS[value], count: work.counts[value] }))} onChange={column => go({ ...query, column })}>
                    <WorkColumn column={query.column} work={work} query={query} now={now} />
                  </SegmentedControl></div>
                </> : null}
        </div>
      </LoadingRegion>
    </Tabs>
  </div></section>;
}
function WorkColumn({ column, work, query, now }: { column: MyWorkColumn; work: MyWorkData; query: MyWorkQuery; now?: string }) {
  const id = useId();
  return <section className={styles.column} aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`}>{MY_WORK_LABELS[column]} <span>{work.counts[column]}</span></h2>
    <div className={styles.cards}>{work.columns[column].length ? work.columns[column].map(job => <MyWorkCard key={job.id} job={job} query={query} autoReleaseHours={work.autoReleaseHours} now={now ? new Date(now) : undefined} />) : <p className={styles.nothing}>Nothing here.</p>}</div>
    {column === "done" && <TextLink href="/earnings">See all paid</TextLink>}
  </section>;
}
