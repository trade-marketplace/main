"use client";
// The office Payments page (#176, F11, no mockup: built like All jobs, src/components/office/AllJobs.tsx): every
// payment in a table, with search, status / kind / date filters, 25 a page, the totals for the filtered list and
// Export CSV. Refund on a row opens the job admin's own refund dialog (RefundDialog in ./JobAdmin.tsx), which calls
// the job admin's action, so there is one refund path. The server reads the payments (src/server/office/payments.ts);
// this only shows them and moves the list's state in the URL, so Back, refresh and a shared link keep the list.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button, buttonClasses } from "@/components/Button";
import { KpiCard } from "@/components/cards/StatCards";
import { type Column, DataTable, FilterBar, type FilterValues, Pagination, TableItem } from "@/components/data";
import { EmptyState, ErrorState, LoadingRegion, OfflineBanner, Skeleton, useOnlineStatus } from "@/components/feedback";
import { Icon } from "@/components/Icon";
import { Banner } from "@/components/overlays/Banner";
import { Pill } from "@/components/status/Pill";
import {
  OFFICE_PAYMENTS_EXPORT_PATH,
  OFFICE_PAYMENTS_PAGE_SIZE,
  OFFICE_PAYMENTS_PATH,
  officePaymentFilters,
  officePaymentsSearch,
  type OfficePaymentsQuery,
  PAYMENT_KIND_LABELS,
  PAYMENT_STATUSES,
  paymentDay,
  paymentFilterValues,
  paymentMoney,
  paymentsFiltered,
} from "@/lib/office-payments";
import { OFFICE_JOB_PATH } from "@/lib/office-job";
import { jobAction } from "@/server/office/job-actions";
import type { OfficePaymentRow, OfficePaymentsPage } from "@/server/office/payments";

import { RefundDialog, type SubmitJobAction } from "./JobAdmin";
import styles from "./payments.module.css";

/** Wait this long after the last key before searching, as All jobs does. */
const SEARCH_DELAY_MS = 300;
const OFFLINE = "You’re offline";

export type OfficePaymentsProps = {
  query: OfficePaymentsQuery;
  /** A page of payments, or null when they couldn't be read. */
  data: OfficePaymentsPage | null;
  loading?: boolean;
  /** Previews: show the page as if offline. */
  offline?: boolean;
  /** Where the list's links go. Previews pass their own page. */
  basePath?: string;
  /** Where Export CSV downloads from. Previews pass a sample file. */
  exportHref?: (search: string) => string;
  /** The refund action. Default: the job admin's own (`jobAction`); previews pass a pretend one. */
  submit?: SubmitJobAction;
  /** Read the list again after a refund. Default: router.refresh(). */
  refresh?: () => void;
  /** Previews: start with the refund dialog open on this payment. */
  initialRefundId?: string | null;
};

export function OfficePayments({
  query,
  data,
  loading = false,
  offline = false,
  basePath = OFFICE_PAYMENTS_PATH,
  exportHref = (search) => `${OFFICE_PAYMENTS_EXPORT_PATH}${search}`,
  submit = jobAction,
  refresh,
  initialRefundId = null,
}: OfficePaymentsProps) {
  const router = useRouter();
  const browserOnline = useOnlineStatus();
  const online = browserOnline && !offline;
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(query.q);
  const [refunding, setRefunding] = useState<OfficePaymentRow | null>(() => data?.rows.find((row) => row.id === initialRefundId) ?? null);
  const [notice, setNotice] = useState<string | null>(null);

  // The latest list state, for navigations started after a delay (the search) or while another is on its way.
  const latest = useRef(query);
  useEffect(() => {
    latest.current = query;
  }, [query]);

  const go = (next: Partial<OfficePaymentsQuery>, { replace = false }: { replace?: boolean } = {}) => {
    latest.current = { ...latest.current, page: 1, ...next };
    const search = officePaymentsSearch(latest.current);
    startTransition(() => (replace ? router.replace : router.push)(`${basePath}${search}`, { scroll: false }));
  };
  const reload = () => startTransition(() => (refresh ? refresh() : router.refresh()));

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

  const busy = loading || pending;
  const total = data?.total ?? 0;
  const filtered = paymentsFiltered(query);
  const shown = paymentFilterValues(query);
  const changeFilters = (values: FilterValues) => {
    const changed = Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== shown[key]));
    go(changed as Partial<OfficePaymentsQuery>);
  };
  const clearAll = () => {
    typed.current = false;
    setQ("");
    go({ status: "all", kind: "all", date: "all", q: "" });
  };

  const exportBlocked = !online || total === 0;

  const columns: Column<OfficePaymentRow>[] = [
    { key: "date", header: "Date", nowrap: true, cell: (row) => <time dateTime={row.date}>{paymentDay(row.date)}</time> },
    {
      key: "job",
      header: "Job",
      primary: true,
      cell: (row) => <TableItem title={row.job.title} meta={row.job.number} href={`${OFFICE_JOB_PATH}/${row.job.id}`} />,
    },
    {
      key: "customer",
      header: "Customer",
      cell: (row) => (
        <span className={styles.person}>
          <span>{row.customer}</span>
          <span className={styles.email}>{row.email}</span>
        </span>
      ),
    },
    { key: "kind", header: "Kind", nowrap: true, optional: true, cell: (row) => PAYMENT_KIND_LABELS[row.kind] },
    { key: "amount", header: "Amount", align: "end", nowrap: true, cell: (row) => paymentMoney(row.amountCents) },
    {
      key: "refunded",
      header: "Refunded",
      align: "end",
      nowrap: true,
      cell: (row) => (row.refundedCents > 0 ? paymentMoney(row.refundedCents) : <span aria-label="None">—</span>),
    },
    { key: "status", header: "Status", nowrap: true, cell: (row) => <Pill kind={PAYMENT_STATUSES[row.status].kind}>{PAYMENT_STATUSES[row.status].label}</Pill> },
    {
      key: "stripe",
      header: "Stripe id",
      optional: true,
      truncate: true,
      text: (row) => row.stripeId ?? "None",
      cell: (row) => (row.stripeId ? <span className={styles.stripe}>{row.stripeId}</span> : <span aria-label="None">—</span>),
    },
  ];

  const kpiSkeleton = (
    <div className={styles.kpis}>
      {[0, 1, 2].map((item) => (
        <div key={item} className={styles.kpiSkeleton}>
          <Skeleton width="55%" />
          <Skeleton width="70%" height={32} />
        </div>
      ))}
    </div>
  );

  return (
    <div className={styles.page} data-mode="office">
      <div className={styles.head}>
        <h1 className={styles.title}>Payments</h1>
        <a
          className={buttonClasses({ variant: "secondary", size: "sm", width: "auto" })}
          href={exportHref(officePaymentsSearch(query, { page: 1 }))}
          download
          aria-disabled={exportBlocked || undefined}
          title={!online ? OFFLINE : undefined}
          onClick={(event) => exportBlocked && event.preventDefault()}
        >
          <Icon name="download" size="sm" decorative />
          Export CSV
        </a>
      </div>
      <OfflineBanner online={offline ? false : undefined} sticky={false} onRetry={reload} />
      {notice && (
        <Banner tone="good" live onDismiss={() => setNotice(null)}>
          {notice}
        </Banner>
      )}
      <FilterBar
        label="Filter payments"
        className={styles.filters}
        search={{
          label: "Search payments",
          placeholder: "Search",
          value: q,
          onChange: (text) => {
            typed.current = true;
            setQ(text);
          },
        }}
        filters={officePaymentFilters()}
        values={shown}
        onChange={changeFilters}
        onClear={clearAll}
      />
      {(data || loading) && (
        <LoadingRegion loading={loading} label="Loading totals" skeleton={kpiSkeleton}>
          {data && (
            <section className={styles.kpis} aria-label={filtered ? "Totals for these payments" : "Totals"}>
              <KpiCard label="Paid" value={paymentMoney(data.totals.paidCents)} />
              <KpiCard label="Refunded" value={paymentMoney(data.totals.refundedCents)} />
              <KpiCard label="Net" value={paymentMoney(data.totals.netCents)} />
            </section>
          )}
        </LoadingRegion>
      )}
      <DataTable
        caption="Payments"
        columns={columns}
        rows={data?.rows ?? []}
        rowId={(row) => row.id}
        rowLabel={(row) => `${row.job.number}, ${PAYMENT_KIND_LABELS[row.kind]}`}
        loading={busy}
        loadingLabel="Loading payments"
        rowActions={(row) => (
          <Button
            variant="secondary"
            size="sm"
            width="auto"
            disabled={!online ? OFFLINE : row.refundableCents === 0 ? "Nothing to refund" : false}
            aria-label={`Refund ${row.job.number}, ${PAYMENT_KIND_LABELS[row.kind]}`}
            onClick={() => setRefunding(row)}
          >
            Refund
          </Button>
        )}
        error={
          data === null && !loading ? (
            <ErrorState title="Can’t load payments" message="Check your connection and try again." onRetry={reload} retrying={pending} headingLevel={2} />
          ) : undefined
        }
        empty={
          filtered ? (
            <EmptyState
              icon="search_off"
              title="No payments match that."
              message="Try fewer filters, or search for a job number."
              action={
                <Button variant="secondary" width="auto" onClick={clearAll}>
                  Clear filters
                </Button>
              }
              headingLevel={2}
            />
          ) : (
            <EmptyState icon="receipt_long" title="No payments yet." headingLevel={2} />
          )
        }
        footer={
          data && total > 0 ? (
            <Pagination
              label="Payments"
              page={data.page}
              pageSize={OFFICE_PAYMENTS_PAGE_SIZE}
              total={total}
              onPageChange={(next) => {
                latest.current = { ...latest.current, page: next };
                const search = officePaymentsSearch(latest.current);
                startTransition(() => router.push(`${basePath}${search}`));
              }}
            />
          ) : undefined
        }
      />
      {refunding && (
        <RefundDialog
          key={refunding.id}
          job={{
            id: refunding.job.id,
            status: refunding.job.status,
            payments: [{ id: refunding.id, label: PAYMENT_KIND_LABELS[refunding.kind], amountCents: refunding.amountCents, refundableCents: refunding.refundableCents }],
          }}
          submit={submit}
          onClose={() => setRefunding(null)}
          onDone={() => {
            setRefunding(null);
            setNotice(`Refund recorded for ${refunding.job.number}.`);
            reload();
          }}
        />
      )}
    </div>
  );
}
