"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { DataTable, Pagination, TableItem } from "@/components/data";
import { EmptyState, ErrorState, OfflineBanner } from "@/components/feedback";
import { Pill } from "@/components/status/Pill";
import { PAYMENT_PAGE_SIZE, paymentAmount, paymentDate, paymentKindLabel, type PaymentPage } from "@/lib/account/payments-list";
import account from "./account.module.css";
import styles from "./payments-list.module.css";

export function PaymentsList({ data, loading = false, offline, onRetry, pageHref }: { data: PaymentPage | null; loading?: boolean; offline?: boolean; onRetry?: () => void; pageHref?: (page: number) => string }) {
  const router = useRouter();
  const [retrying, startTransition] = useTransition();
  const retry = () => startTransition(() => { if (onRetry) onRetry(); else router.refresh(); });
  return <section className={styles.section} aria-labelledby="payments-title">
    <h1 className={account.title} id="payments-title">Payments</h1>
    <OfflineBanner sticky={false} online={offline === undefined ? undefined : !offline} onRetry={retry} />
    <DataTable caption="Payments" rows={data?.rows ?? []} rowId={row => row.id} rowLabel={row => row.job.title}
      loading={loading} loadingLabel="Loading payments" skeletonRows={3}
      columns={[
        { key: "date", header: "Date", cell: row => row.date ? <time dateTime={row.date}>{paymentDate(row.date)}</time> : "—", nowrap: true },
        { key: "job", header: "Job", primary: true, cell: row => <TableItem title={row.job.title} href={`/jobs/${row.job.id}`} meta={<><span className={styles.jobNumber}>TM-{String(row.job.jobNumber).padStart(4, "0")}</span><span>{paymentKindLabel(row.kind)}</span></>} /> },
        { key: "amount", header: "Amount", align: "end", nowrap: true, cell: row => <span className={styles.amount}>{paymentAmount(row.amountCents)}</span> },
        { key: "status", header: "Status", cell: row => <Pill kind={row.status === "Paid" ? "good" : "info"}>{row.status}</Pill>, nowrap: true },
      ]}
      empty={<EmptyState icon="credit_card" title="No payments yet." />}
      error={!data && !loading ? <ErrorState title="Can’t load your payments" message="Check your connection and try again." onRetry={retry} retrying={retrying} /> : undefined}
      footer={data && data.total > 0 && !loading ? <Pagination label="Payment pages" page={data.page} pageSize={PAYMENT_PAGE_SIZE} total={data.total} getHref={pageHref ?? (page => `/profile/payments?page=${page}`)} /> : undefined}
    />
    <p className={styles.hint}>Tax invoices are coming soon.</p>
  </section>;
}
