"use client";
// Cancellations & disputes (#172, F06, /admin/disputes): every open case, oldest first: what kind, how long it has
// waited, the customer, the tradie and what was paid. No mockup: it follows the office queues' table (F01) and the
// job admin view (F05). The server reads the cases (src/server/office/disputes.ts). Every state:
// /dev/components/office-disputes.
import { useRouter } from "next/navigation";

import { Button } from "@/components/Button";
import { DataTable, Pagination, TableItem, type Column } from "@/components/data";
import { EmptyState, ErrorState, OfflineBanner, useOnlineStatus } from "@/components/feedback";
import { DISPUTES_PAGE_SIZE, DISPUTES_PATH, type DisputeListData, type DisputeRow } from "@/lib/office-disputes";
import { money } from "@/lib/office-job";

import styles from "./disputes.module.css";

export type DisputesListProps = {
  /** The cases, or null when they couldn't be read. */
  data: DisputeListData | null;
  loading?: boolean;
  /** Previews: show the offline state. */
  offline?: boolean;
  /** Previews: where a row opens, and the pages' base. */
  rowHref?: (row: DisputeRow) => string;
  base?: string;
};

export function DisputesList({ data, loading = false, offline = false, rowHref = (row) => row.href, base = DISPUTES_PATH }: DisputesListProps) {
  const router = useRouter();
  const online = useOnlineStatus() && !offline;
  const columns: Column<DisputeRow>[] = [
    { key: "job", header: "Job", primary: true, cell: (row) => <TableItem title={row.title} meta={`${row.number} · ${row.kindLabel}`} href={online ? rowHref(row) : undefined} /> },
    { key: "detail", header: "Reason", cell: (row) => <span className={styles.clamp}>{row.detail}</span> },
    { key: "customer", header: "Customer", cell: (row) => row.customer },
    { key: "tradie", header: "Tradie", cell: (row) => row.tradie ?? "—" },
    {
      key: "paid",
      header: "Paid",
      cell: (row) => (
        <span className={styles.nowrap}>
          {row.paidCents > 0 ? `${money(row.paidCents)}${row.refundedCents > 0 ? ` · ${money(row.refundedCents)} back` : ""}` : "Not paid"}
        </span>
      ),
    },
    { key: "age", header: "Waiting", cell: (row) => <time dateTime={row.since} className={styles.nowrap}>{row.age}</time> },
  ];
  const count = data?.total ?? 0;
  return (
    <div className={styles.page}>
      <OfflineBanner online={offline ? false : undefined} onRetry={() => router.refresh()} sticky={false} />
      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.title}>Cancellations &amp; disputes</h1>
          {data && <p className={styles.sub}>{count === 1 ? "1 open case" : `${count} open cases`}, oldest first</p>}
        </div>
      </header>
      <DataTable
        caption="Open cases"
        columns={columns}
        rows={data?.rows ?? []}
        rowId={(row) => row.jobId}
        rowLabel={(row) => row.title}
        rowHref={online ? rowHref : undefined}
        loading={loading}
        loadingLabel="Loading cases"
        rowActions={(row) =>
          online ? (
            <Button href={rowHref(row)} variant="secondary" size="sm" width="auto" aria-label={`Open ${row.number}`}>
              Open
            </Button>
          ) : (
            <Button variant="secondary" size="sm" width="auto" disabled="You’re offline">
              Open
            </Button>
          )
        }
        error={!data && !loading ? <ErrorState title="Can’t load cases" message="Check your connection and try again." onRetry={() => router.refresh()} /> : undefined}
        empty={<EmptyState icon="task_alt" title="All clear" message="No cancellations or problems are waiting." />}
        footer={
          data && data.total > DISPUTES_PAGE_SIZE ? (
            <Pagination label="Cases" page={data.page} pageSize={DISPUTES_PAGE_SIZE} total={data.total} getHref={(page) => `${base}${base.includes("?") ? "&" : "?"}page=${page}`} />
          ) : undefined
        }
      />
    </div>
  );
}
