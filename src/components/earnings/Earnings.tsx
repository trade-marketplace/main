"use client";
// The tradie's Earnings page (#165, D12; pages.html w-t-earnings, screens.html tr-earnings): what they've been paid,
// what is queued for the next payroll, what is waiting on a customer's sign-off, an 8-week chart and a payroll
// table whose rows open the per-job breakdown (hours, rate, holiday pay) in a drawer.
//
// The server reads and works out every figure (src/server/earnings, src/lib/earnings.ts); this only shows them.
// Wording is exact: "Queued" until payroll has paid it, then "Paid"; nothing here says money moved before it has.
// A computer shows the three KPI cards, the chart and the table; a phone shows the Forest money card and the
// lists, as in the two mockups. The open payroll is in the URL (`?payroll=`), so Back closes it and a link keeps it.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type CSSProperties, useEffect, useRef, useState, useTransition } from "react";

import { Button, buttonClasses } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { KpiCard, StatCard } from "@/components/cards/StatCards";
import { type Column, DataTable, TableItem } from "@/components/data";
import { EmptyState, ErrorState, LoadingRegion, Skeleton } from "@/components/feedback";
import { Banner } from "@/components/overlays/Banner";
import { Drawer } from "@/components/overlays/Drawer";
import { Pill } from "@/components/status/Pill";
import { TextLink } from "@/components/TextLink";
import {
  barHeights,
  EARNINGS_PATH,
  earningsHref,
  type EarningsView,
  formatCents,
  jobsText,
  NEXT_PAYROLL_ID,
  type Payroll,
  STATEMENT_PATH,
  weekName,
  type Week,
} from "@/lib/earnings";
import type { PayrollDetailsCheck } from "@/server/payouts/queue-payout";

import styles from "./earnings.module.css";

export type EarningsProps = {
  /** What to show, or null when it couldn't be read (the error state). */
  view: EarningsView | null;
  /** Whether payroll has the bank and IRD details it needs. */
  payrollDetails?: PayrollDetailsCheck;
  /** The payroll open in the drawer (`next` or a paid date), from the URL. */
  payroll?: string | null;
  /** A reviewer's `?state=` flag, kept on the links so the view survives opening a payroll. */
  flag?: string;
  /** The page's own path; the dev preview sits somewhere else. */
  basePath?: string;
  statementHref?: string;
  loading?: boolean;
};

const money = (cents: number) => formatCents(cents);
const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

const payrollPill = (payroll: Pick<Payroll, "status">) => <Pill kind={payroll.status === "Paid" ? "good" : "waiting"}>{payroll.status}</Pill>;

export function EarningsSkeleton() {
  return (
    <div className={styles.skeleton}>
      <div className={styles.skeletonKpis}>
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} height={96} className={styles.skeletonBlock} />
        ))}
      </div>
      <div className={styles.skeletonMain}>
        <Skeleton height={220} className={styles.skeletonBlock} />
        <Skeleton height={220} className={styles.skeletonBlock} />
      </div>
    </div>
  );
}

/** The heading and (when it can run) the statement button. */
function Head({ statement, disabled }: { statement?: string; disabled?: boolean }) {
  return (
    <div className={styles.head}>
      <h1 className={styles.title}>Earnings</h1>
      {statement && (
        <a
          className={buttonClasses({ variant: "secondary", size: "sm", width: "auto" })}
          href={statement}
          download
          aria-disabled={disabled || undefined}
          onClick={(event) => disabled && event.preventDefault()}
        >
          <Icon name="download" size="sm" decorative />
          Download statement
        </a>
      )}
    </div>
  );
}

export function Earnings({
  view,
  payrollDetails,
  payroll = null,
  flag = "default",
  basePath = EARNINGS_PATH,
  statementHref = STATEMENT_PATH,
  loading = false,
}: EarningsProps) {
  const router = useRouter();
  const [retrying, startTransition] = useTransition();
  const href = (id: string | null) => earningsHref({ state: flag, payroll: id }, basePath);

  // Back closes the drawer when it was opened from this page; a shared link just goes to the list.
  const openedHere = useRef(false);
  const previous = useRef(payroll);
  useEffect(() => {
    if (payroll && !previous.current) openedHere.current = true;
    if (!payroll) openedHere.current = false;
    previous.current = payroll;
  }, [payroll]);
  const closeDrawer = () => {
    if (openedHere.current) router.back();
    else router.replace(href(null), { scroll: false });
  };

  if (loading) {
    return (
      <Shell>
        <Head />
        <LoadingRegion loading label="Loading your earnings" skeleton={<EarningsSkeleton />} />
      </Shell>
    );
  }

  if (!view) {
    return (
      <Shell>
        <Head />
        <ErrorState
          title="Can’t load your earnings"
          message="Check your connection and try again."
          onRetry={() => startTransition(() => router.refresh())}
          retrying={retrying}
          headingLevel={2}
        />
      </Shell>
    );
  }

  if (view.isEmpty) {
    return (
      <Shell>
        <Head statement={statementHref} disabled />
        <EmptyState
          icon="payments"
          title="No earnings yet."
          message="Once a customer signs off your first job, it shows up here."
          action={
            <Button href="/jobs" width="auto">
              Find work
            </Button>
          }
          headingLevel={2}
        />
      </Shell>
    );
  }

  const next = view.payrolls.find((item) => item.id === NEXT_PAYROLL_ID) ?? null;
  const paid = view.payrolls.filter((item) => item.status === "Paid");
  // Queued for an earlier payday that payroll hasn't confirmed: it keeps its date instead of sliding to the next one.
  const overdue = view.payrolls.filter((item) => item.late);
  const open = view.payrolls.find((item) => item.id === payroll) ?? null;
  const missingDetails = payrollDetails && !payrollDetails.complete && (view.next.jobs > 0 || view.waiting.jobs > 0);

  const columns: Column<Payroll>[] = [
    {
      key: "payroll",
      header: "Payroll",
      primary: true,
      cell: (item) => <TableItem title={item.label} href={href(item.id)} current={item.id === open?.id} />,
    },
    { key: "jobs", header: "Jobs", nowrap: true, cell: (item) => item.lines.length },
    { key: "total", header: "Total", nowrap: true, align: "end", cell: (item) => <b>{money(item.totalCents)}</b> },
    { key: "status", header: "Status", nowrap: true, cell: (item) => payrollPill(item) },
  ];

  const monthTitle = `Paid in ${view.month}`;
  const monthNote = `${jobsText(view.paidThisMonth.jobs)} · holiday pay included`;

  return (
    <Shell>
      <Head statement={statementHref} />

      {missingDetails && (
        <Banner tone="info" title="Add bank account & IRD number." action={<TextLink href="/profile/payroll">Add</TextLink>}>
          So we can pay you through payroll.
        </Banner>
      )}

      {/* A computer: the three KPI cards, the chart and the payroll table (w-t-earnings). */}
      <div className={cx(styles.kpis, styles.wide)}>
        <KpiCard label={monthTitle} value={view.paidThisMonth.totalCents} format={money} note={monthNote} />
        <KpiCard
          label={`Next payroll · ${view.next.label}`}
          value={view.next.totalCents}
          format={money}
          note={`${jobsText(view.next.jobs)} signed off`}
        />
        <KpiCard label="Waiting on sign-off" value={view.waiting.totalCents} format={money} note={jobsText(view.waiting.jobs)} />
      </div>

      <div className={cx(styles.main, styles.wide)}>
        <Chart weeks={view.weeks} />
        <section aria-labelledby="payrolls-heading" className={styles.payrolls}>
          <h2 id="payrolls-heading" className={styles.visuallyHidden}>
            Payrolls
          </h2>
          <DataTable
            caption="Payrolls"
            columns={columns}
            rows={view.payrolls}
            rowId={(item) => item.id}
            rowLabel={(item) => `${item.status} payroll ${item.label}`}
            rowHref={(item) => href(item.id)}
            activeRowId={open?.id ?? null}
            empty={<EmptyState icon="payments" title="No payrolls yet." headingLevel={3} />}
          />
        </section>
      </div>

      {/* A phone: the Forest money card, then the next payroll and the paid ones as lists (tr-earnings). */}
      <div className={cx(styles.phone)}>
        <StatCard label={monthTitle} value={view.paidThisMonth.totalCents} format={money} note={monthNote} />

        {(next || view.waiting.items.length > 0) && (
          <section aria-labelledby="next-heading" className={styles.list}>
            <h2 id="next-heading" className={styles.listTitle}>
              Next payroll · {view.next.label}
            </h2>
            <ul className={styles.rows}>
              {next?.lines.map((line) => (
                <li key={line.id} className={styles.row}>
                  <div className={styles.rowText}>
                    <Link className={styles.rowLink} href={href("next")}>
                      {line.title}
                    </Link>
                    <span className={styles.caption}>
                      {line.jobNumber} · signed off {line.signedOff}
                    </span>
                  </div>
                  <div className={styles.rowAmount}>
                    <b>{line.total}</b>
                    <Pill kind="waiting">Queued</Pill>
                  </div>
                </li>
              ))}
              {view.waiting.items.map((job) => (
                <li key={job.id} className={styles.row}>
                  <div className={styles.rowText}>
                    <b className={styles.rowName}>{job.title}</b>
                    <span className={styles.caption}>
                      {job.jobNumber} · {job.submitted ? "sent for sign-off" : "in progress"}
                    </span>
                  </div>
                  <div className={styles.rowAmount}>
                    <b>{money(job.totalCents)}</b>
                    <Pill kind="waiting">After sign-off</Pill>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {overdue.length > 0 && (
          <section aria-labelledby="queued-heading" className={styles.list}>
            <h2 id="queued-heading" className={styles.listTitle}>
              Queued
            </h2>
            <ul className={styles.rows}>
              {overdue.map((item) => (
                <li key={item.id} className={styles.row}>
                  <div className={styles.rowText}>
                    <Link className={styles.rowLink} href={href(item.id)}>
                      Payroll {item.short}
                    </Link>
                    <span className={styles.caption}>{jobsText(item.lines.length)}</span>
                  </div>
                  <div className={styles.rowAmount}>
                    <b>{money(item.totalCents)}</b>
                    <Pill kind="waiting">Queued</Pill>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {paid.length > 0 && (
          <section aria-labelledby="paid-heading" className={styles.list}>
            <h2 id="paid-heading" className={styles.listTitle}>
              Paid
            </h2>
            <ul className={styles.rows}>
              {paid.map((item) => (
                <li key={item.id} className={styles.row}>
                  <div className={styles.rowText}>
                    <Link className={styles.rowLink} href={href(item.id)}>
                      Payroll {item.short}
                    </Link>
                    <span className={styles.caption}>{jobsText(item.lines.length)}</span>
                  </div>
                  <b className={styles.rowAmount}>{money(item.totalCents)}</b>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <PayrollDrawer payroll={open} onClose={closeDrawer} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <div className={cx(styles.content, "tm-anim-rise")}>{children}</div>
    </div>
  );
}

/** The last eight weeks, this week in Hi-Vis. Hover or focus a bar for the amount. */
function Chart({ weeks }: { weeks: readonly Week[] }) {
  const heights = barHeights(weeks);
  return (
    <section aria-labelledby="chart-heading" className={styles.chart}>
      <h2 id="chart-heading" className={styles.chartTitle}>
        Last 8 weeks
      </h2>
      <ul className={styles.bars}>
        {weeks.map((week, index) => (
          <li
            key={week.start}
            tabIndex={0}
            aria-label={weekName(week)}
            className={cx(styles.bar, week.current && styles.current)}
            style={{ "--bar": `${heights[index]}%` } as CSSProperties}
          >
            <span className={styles.fill} aria-hidden="true" />
            <span className={styles.tip} aria-hidden="true">
              {money(week.totalCents)}
            </span>
          </li>
        ))}
      </ul>
      <div className={styles.axis} aria-hidden="true">
        <span>{weeks[0]?.label}</span>
        <span>{weeks[weeks.length - 1]?.label}</span>
      </div>
    </section>
  );
}

/** One payroll's jobs: hours, rate, pay and holiday pay for each, then the total. */
function PayrollDrawer({ payroll, onClose }: { payroll: Payroll | null; onClose: () => void }) {
  // Keep the last payroll while the drawer slides out, so it doesn't empty mid-motion.
  const [last, setLast] = useState<Payroll | null>(payroll);
  if (payroll && payroll !== last) setLast(payroll);
  const shown = payroll ?? last;
  return (
    <Drawer
      open={payroll !== null}
      onClose={onClose}
      eyebrow={shown && <span className={styles.eyebrow}>{payrollPill(shown)}</span>}
      title={shown ? (shown.id === NEXT_PAYROLL_ID ? `Next payroll · ${shown.label}` : `Payroll ${shown.short}`) : "Payroll"}
    >
      {shown && (
        <>
          <ul className={styles.detail}>
            {shown.lines.map((line) => (
              <li key={line.id} className={styles.detailJob}>
                <div className={styles.rowText}>
                  <b className={styles.rowName}>{line.title}</b>
                  <span className={styles.caption}>
                    {line.jobNumber} · signed off {line.signedOff}
                  </span>
                </div>
                <dl className={styles.facts}>
                  <div>
                    <dt>Hours</dt>
                    <dd>{line.hours}</dd>
                  </div>
                  <div>
                    <dt>Rate</dt>
                    <dd>{line.rate}</dd>
                  </div>
                  <div>
                    <dt>Pay</dt>
                    <dd>{line.gross}</dd>
                  </div>
                  <div>
                    <dt>Holiday pay</dt>
                    <dd>{line.holidayPay}</dd>
                  </div>
                  <div className={styles.factTotal}>
                    <dt>Total</dt>
                    <dd>{line.total}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          {shown.lines.length > 1 && (
            <p className={styles.detailTotal}>
              <span>Total</span>
              <b>{money(shown.totalCents)}</b>
            </p>
          )}
        </>
      )}
    </Drawer>
  );
}
