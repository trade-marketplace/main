"use client";
// The office Payouts page (#175, F10, pages.html w-o-payouts): the next payroll batch, who is held back for missing
// payroll details, Export payroll CSV and Mark batch paid (#166), and the batches already sent. Honest banner: these
// are records; nothing on this screen moves money. KPIs count up on first view (M17); the confirm dialog is M13.
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { Button, buttonClasses } from "@/components/Button";
import { TextLink } from "@/components/TextLink";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { KpiCard } from "@/components/cards/StatCards";
import { DataTable, TableItem, type Column } from "@/components/data";
import { EmptyState, ErrorState, LoadingRegion, OfflineBanner, Skeleton, useOnlineStatus } from "@/components/feedback";
import { Banner, type BannerTone } from "@/components/overlays/Banner";
import { ConfirmDialog } from "@/components/overlays/Dialog";
import { Pill } from "@/components/status/Pill";
import type { AuthFailure } from "@/lib/auth/results";
import {
  awaitingBatch,
  batchDownloadHref,
  blockedNote,
  blockerLabel,
  dayLabel,
  holidayShare,
  hoursLabel,
  money,
  paydayLabel,
  plural,
  shortDay,
  type ExportPayrollResult,
  type MarkPaidResult,
  type OfficePayoutsData,
  type PayoutBatch,
  type PayoutsState,
  type QueuedPayoutRow,
} from "@/lib/office/payouts";
import { exportPayrollAction, markBatchPaidAction } from "@/server/office/payout-actions";

import styles from "./payouts.module.css";

type Notice = { tone: BannerTone; text: string; action?: ReactNode };

export type OfficePayoutsProps = {
  data: OfficePayoutsData | null;
  loading?: boolean;
  /** Previews only: show the page as if offline, or with the mark-paid dialog already open. */
  state?: PayoutsState;
  /** A message already on the page (previews: after an export or a mark paid). */
  initialNotice?: Notice;
  exportPayroll?: () => Promise<ExportPayrollResult | AuthFailure>;
  markPaid?: (batchKey: string) => Promise<MarkPaidResult | AuthFailure>;
  downloadHref?: (batchKey: string) => string;
  /** Read the page again after a change. Default: router.refresh(). */
  refresh?: () => void;
};

const OFFLINE = "You’re offline";
const EXPORT_FAILED = "Couldn’t export. Nothing was marked. Try again.";
const PAID_FAILED = "Couldn’t mark the batch paid. Try again.";
const moneyFromCents = (cents: number) => money(cents);

/** Hands the browser the CSV the export built, as a download. */
function saveFile(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function exportedNotice(batch: PayoutBatch, heldBack: number, href: string): Notice {
  const held = heldBack > 0 ? ` ${plural(heldBack, "payout", "payouts")} held back for missing payroll details.` : "";
  return {
    tone: "good",
    text: `Exported ${plural(batch.count, "payout", "payouts")} · ${money(batch.totalCents)} for ${paydayLabel(batch.payday)}.${held}`,
    action: <a className={buttonClasses({ variant: "tertiary", size: "sm" })} href={href} download>Download again</a>,
  };
}

export function paidNotice(batch: PayoutBatch, notified: number): Notice {
  return { tone: "good", text: `${paydayLabel(batch.payday)} batch marked paid. ${plural(notified, "tradie", "tradies")} told.` };
}

export function OfficePayouts({
  data,
  loading = false,
  state,
  initialNotice,
  exportPayroll = exportPayrollAction,
  markPaid = markBatchPaidAction,
  downloadHref = (key) => batchDownloadHref(key),
  refresh,
}: OfficePayoutsProps) {
  const router = useRouter();
  const session = useOptionalSessionExpired();
  const browserOnline = useOnlineStatus();
  const [pending, startTransition] = useTransition();
  const online = browserOnline && state !== "offline";
  const awaiting = data ? awaitingBatch(data.batches) : null;
  const [notice, setNotice] = useState<Notice | null>(initialNotice ?? null);
  const [exporting, setExporting] = useState(false);
  const [target, setTarget] = useState<PayoutBatch | null>(() => (state === "mark-paid" ? awaiting : null));
  const [dialogError, setDialogError] = useState<string | null>(null);

  const reload = () => startTransition(() => (refresh ? refresh() : router.refresh()));
  const busy = loading || pending;

  async function runExport() {
    if (exporting || !online) return;
    setExporting(true);
    setNotice(null);
    try {
      const reply = await exportPayroll();
      if (session?.check(reply)) return;
      if (!("status" in reply)) return setNotice({ tone: "alert", text: "Only the office can export payroll." });
      if (reply.status === "exported") {
        saveFile(reply.csv, reply.filename);
        setNotice(exportedNotice(reply.batch, reply.heldBack, downloadHref(reply.batch.key)));
        reload();
      } else if (reply.status === "nothing") {
        setNotice({ tone: "info", text: reply.heldBack ? "Nothing to export. Everyone queued is missing payroll details." : "Nothing to export. Nothing is queued." });
        reload();
      } else if (reply.status === "forbidden") setNotice({ tone: "alert", text: "Only the office can export payroll." });
      else setNotice({ tone: "alert", text: EXPORT_FAILED });
    } catch {
      setNotice({ tone: "alert", text: EXPORT_FAILED });
    } finally {
      setExporting(false);
    }
  }

  function openPaid(batch: PayoutBatch) {
    setDialogError(null);
    setTarget(batch);
  }

  async function confirmPaid() {
    if (!target) return;
    if (!online) return setDialogError(`${OFFLINE}. Try again when you’re back online.`);
    setDialogError(null);
    try {
      const reply = await markPaid(target.key);
      if (session?.check(reply)) return;
      if (!("status" in reply) || reply.status === "forbidden") return setDialogError("Only the office can mark batches paid.");
      if (reply.status === "paid") {
        setTarget(null);
        setNotice(paidNotice(reply.batch, reply.notified));
        reload();
      } else if (reply.status === "already-paid") {
        setTarget(null);
        setNotice({ tone: "info", text: `${paydayLabel(reply.batch.payday)} batch was already marked paid.` });
        reload();
      } else if (reply.status === "not-found") setDialogError("That batch has changed. Close this and try again.");
      else setDialogError(PAID_FAILED);
    } catch {
      setDialogError(PAID_FAILED);
    }
  }

  const exportReason = !online ? OFFLINE : !data ? true : data.ready.count === 0 ? "Nothing ready to export" : false;
  const paidReason = !online ? OFFLINE : !awaiting ? "No exported batch waiting" : false;

  const queuedColumns: Column<QueuedPayoutRow>[] = [
    { key: "tradie", header: "Tradie", primary: true, cell: (row) => <TableItem title={row.tradie} /> },
    {
      key: "job",
      header: "Job",
      cell: (row) => (
        <span className={styles.job}>
          <TextLink inline href={`/admin/jobs/${row.jobId}`}>{row.jobNumber}</TextLink> {row.title}
        </span>
      ),
    },
    { key: "signedOff", header: "Signed off", nowrap: true, optional: true, cell: (row) => <time dateTime={row.signedOffAt}>{dayLabel(row.signedOffAt)}</time> },
    { key: "hours", header: "Hours", align: "end", nowrap: true, optional: true, cell: (row) => hoursLabel(row.minutes) },
    { key: "holiday", header: "Holiday pay", align: "end", nowrap: true, optional: true, cell: (row) => money(row.holidayPayCents) },
    { key: "total", header: "Total", align: "end", nowrap: true, cell: (row) => money(row.totalCents) },
    {
      key: "status",
      header: "Status",
      nowrap: true,
      cell: (row) => (row.blockers.length ? <Pill kind="alert">{blockerLabel(row.blockers)}</Pill> : <Pill kind="waiting">Queued</Pill>),
    },
  ];

  const batchColumns: Column<PayoutBatch>[] = [
    { key: "payday", header: "Payday", primary: true, cell: (batch) => <TableItem title={paydayLabel(batch.payday)} meta={`Exported ${dayLabel(batch.key)}`} /> },
    { key: "payouts", header: "Payouts", cell: (batch) => `${plural(batch.count, "job", "jobs")} · ${plural(batch.tradies, "tradie", "tradies")}` },
    { key: "total", header: "Total", align: "end", nowrap: true, cell: (batch) => money(batch.totalCents) },
    {
      key: "status",
      header: "Status",
      nowrap: true,
      cell: (batch) => (batch.status === "PAID" ? <Pill kind="good">{batch.paidAt ? `Paid ${shortDay(batch.paidAt)}` : "Paid"}</Pill> : <Pill kind="waiting">Exported</Pill>),
    },
  ];

  const kpiSkeleton = (
    <div className={styles.kpis}>
      {[0, 1, 2].map((item) => (
        <div key={item} className={styles.kpiSkeleton}>
          <Skeleton width="55%" />
          <Skeleton width="70%" height={32} />
          <Skeleton width="45%" />
        </div>
      ))}
    </div>
  );

  return (
    <div className={styles.page} data-mode="office">
      <div className={styles.head}>
        <h1 className={styles.title}>Payouts</h1>
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" icon="download" loading={exporting} disabled={exportReason} onClick={() => void runExport()}>
            Export payroll CSV
          </Button>
          <Button size="sm" disabled={paidReason} onClick={() => awaiting && openPaid(awaiting)}>
            Mark batch paid
          </Button>
        </div>
      </div>
      <OfflineBanner online={state === "offline" ? false : undefined} sticky={false} onRetry={reload} />
      <Banner tone="info">These are payroll records. Marking paid doesn’t move money. Pay through payroll first, then mark the batch paid.</Banner>
      {notice && <Banner tone={notice.tone} live action={notice.action} onDismiss={() => setNotice(null)}>{notice.text}</Banner>}

      {data === null && !loading ? (
        <ErrorState title="Can’t load payouts" message="Check your connection and try again." onRetry={reload} retrying={pending} headingLevel={2} />
      ) : (
        <>
          <LoadingRegion loading={loading} label="Loading payouts" skeleton={kpiSkeleton}>
            {data && (
              <div className={styles.kpis}>
                <KpiCard
                  label={`Batch · ${paydayLabel(data.payday)}`}
                  value={data.ready.totalCents}
                  format={moneyFromCents}
                  note={`${plural(data.ready.count, "job", "jobs")} · ${plural(data.ready.tradies, "tradie", "tradies")}`}
                />
                <KpiCard label="Holiday pay in batch" value={data.ready.holidayPayCents} format={moneyFromCents} note={holidayShare(data.ready)} />
                <KpiCard label="Missing payroll details" value={data.blocked.tradies} note={blockedNote(data.blocked)} alert={data.blocked.tradies > 0} />
              </div>
            )}
          </LoadingRegion>

          <DataTable
            caption="Queued payouts"
            columns={queuedColumns}
            rows={data?.rows ?? []}
            rowId={(row) => row.id}
            rowLabel={(row) => `${row.tradie}, ${row.jobNumber}`}
            loading={busy}
            loadingLabel="Loading payouts"
            empty={<EmptyState icon="payments" title="Nothing queued." message="Payouts are queued here when customers sign off jobs." headingLevel={2} />}
          />

          <div className={styles.section}>
            <h2>Batches</h2>
            <DataTable
              caption="Batches"
              columns={batchColumns}
              rows={data?.batches ?? []}
              rowId={(batch) => batch.key}
              rowLabel={(batch) => `${paydayLabel(batch.payday)} batch`}
              loading={busy}
              loadingLabel="Loading batches"
              skeletonRows={3}
              rowActions={(batch) => (
                <span className={styles.rowActions}>
                  <a
                    className={buttonClasses({ variant: "secondary", size: "sm", width: "auto" })}
                    href={downloadHref(batch.key)}
                    download
                    aria-label={`Download CSV, ${paydayLabel(batch.payday)} batch`}
                  >
                    Download CSV
                  </a>
                  {batch.status === "EXPORTED" && (
                    <Button variant="secondary" size="sm" width="auto" disabled={online ? false : OFFLINE} onClick={() => openPaid(batch)} aria-label={`Mark ${paydayLabel(batch.payday)} batch paid`}>
                      Mark paid
                    </Button>
                  )}
                </span>
              )}
              empty={<EmptyState icon="receipt_long" title="No batches yet." message="Each payroll export shows here." headingLevel={3} />}
            />
          </div>
        </>
      )}

      <ConfirmDialog
        open={target !== null}
        title={target ? `Mark the ${paydayLabel(target.payday)} batch paid?` : "Mark batch paid?"}
        confirmLabel="Mark batch paid"
        cancelLabel="Not yet"
        onConfirm={confirmPaid}
        onCancel={() => setTarget(null)}
        error={dialogError}
      >
        {target && (
          <>
            <dl className={styles.dialogFacts}>
              <dt>Payouts</dt>
              <dd>{plural(target.count, "job", "jobs")} · {plural(target.tradies, "tradie", "tradies")}</dd>
              <dt>Total</dt>
              <dd>{money(target.totalCents)}</dd>
            </dl>
            <p className={styles.dialogNote}>Only do this once payroll has paid them. It doesn’t move money. Each tradie is told it’s paid.</p>
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}
