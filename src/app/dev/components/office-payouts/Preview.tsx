"use client";
// Example data for /dev/components/office-payouts. Every name, job and amount is an example; real ones come from
// the server. Export and Mark paid work on this page's own copy, so a reviewer can click through the whole flow.
import { useState } from "react";

import { OfficePayouts, exportedNotice, paidNotice } from "@/components/office/OfficePayouts";
import type { ExportPayrollResult, MarkPaidResult, OfficePayoutsData, PayoutBatch, PayoutsState, QueuedPayoutRow } from "@/lib/office/payouts";

const row = (id: number, tradie: string, job: number, title: string, signedOffAt: string, minutes: number, rateCents: number, blockers: QueuedPayoutRow["blockers"] = []): QueuedPayoutRow & { grossCents: number } => {
  const grossCents = Math.round((minutes * rateCents) / 60), holidayPayCents = Math.round(grossCents * 0.08);
  return { id: `17500000-0000-4000-8000-${String(id).padStart(12, "0")}`, tradie, jobId: `17500000-0000-4000-8000-${String(100 + id).padStart(12, "0")}`, jobNumber: `TM-${job}`, title, signedOffAt, minutes, holidayPayCents, totalCents: grossCents + holidayPayCents, grossCents, blockers };
};

const READY = [
  row(1, "Jack Wilson", 990, "Control panel", "2026-11-02T22:00:00Z", 360, 7000),
  row(2, "Aroha Ngata", 993, "Leaking outdoor tap", "2026-11-03T01:30:00Z", 150, 7000),
  row(3, "Sam Patel", 995, "Hang two doors", "2026-11-04T03:00:00Z", 240, 3800),
  row(4, "Jack Wilson", 1001, "Heat pump wiring", "2026-11-05T21:15:00Z", 180, 7000),
];
const BLOCKED = [row(5, "Mere Rāwiri", 998, "Fence palings", "2026-11-01T23:00:00Z", 330, 3800, ["bank"])];

const PAID: PayoutBatch = { key: "2026-10-30T02:00:00.000Z", payday: "2026-10-30", count: 6, tradies: 3, totalCents: 182_480, status: "PAID", paidAt: "2026-10-31T01:00:00.000Z" };
const OLDER: PayoutBatch = { key: "2026-10-23T02:00:00.000Z", payday: "2026-10-23", count: 4, tradies: 2, totalCents: 120_960, status: "PAID", paidAt: "2026-10-24T01:00:00.000Z" };

function summary(rows: readonly (QueuedPayoutRow & { grossCents: number })[]): OfficePayoutsData["ready"] {
  const ready = rows.filter((item) => !item.blockers.length);
  return { count: ready.length, tradies: new Set(ready.map((item) => item.tradie)).size, totalCents: ready.reduce((sum, item) => sum + item.totalCents, 0), grossCents: ready.reduce((sum, item) => sum + item.grossCents, 0), holidayPayCents: ready.reduce((sum, item) => sum + item.holidayPayCents, 0) };
}

function build(rows: readonly (QueuedPayoutRow & { grossCents: number })[], batches: PayoutBatch[]): OfficePayoutsData {
  const held = rows.filter((item) => item.blockers.length);
  const names = [...new Set(held.map((item) => item.tradie.replace(/^(\S+)\s+(\S).*$/, "$1 $2")))];
  return { payday: "2026-11-20", ready: summary(rows), blocked: { tradies: names.length, payouts: held.length, names }, rows: [...rows], batches };
}

const exportedBatch = (rows: readonly (QueuedPayoutRow & { grossCents: number })[]): PayoutBatch => {
  const ready = summary(rows);
  return { key: "2026-11-19T02:12:00.000Z", payday: "2026-11-20", count: ready.count, tradies: ready.tradies, totalCents: ready.totalCents, status: "EXPORTED", paidAt: null };
};

const SAMPLE_CSV = "﻿Tradie,Email,Job number,Hours,Rate (NZD per hour),Gross (NZD),Holiday pay (NZD),Total (NZD),Payout id\r\nJack Wilson,jack@example.test,TM-990,6,70.00,420.00,33.60,453.60,17500000-0000-4000-8000-000000000001\r\n";
const downloadHref = () => `data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE_CSV)}`;

function initial(state: PayoutsState): OfficePayoutsData | null {
  if (state === "error" || state === "loading") return null;
  if (state === "nothing-queued") return build([], [PAID, OLDER]);
  if (state === "blockers") return build([...BLOCKED, ...READY], [PAID, OLDER]);
  if (state === "exported" || state === "mark-paid") return build(BLOCKED, [exportedBatch([...READY]), PAID, OLDER]);
  if (state === "paid") return build(BLOCKED, [{ ...exportedBatch([...READY]), status: "PAID", paidAt: "2026-11-20T01:00:00.000Z" }, PAID, OLDER]);
  return build(READY, [PAID, OLDER]);
}

export function PayoutsPreview({ state }: { state: PayoutsState }) {
  const [data, setData] = useState(() => initial(state));
  const start = initial(state);
  const notice = state === "exported" && start ? exportedNotice(start.batches[0], 1, downloadHref())
    : state === "paid" && start ? paidNotice(start.batches[0], 3) : undefined;

  async function exportPayroll(): Promise<ExportPayrollResult> {
    if (!data) return { status: "unavailable" };
    const ready = data.rows.filter((item) => !item.blockers.length);
    const heldBack = data.rows.length - ready.length;
    if (!ready.length) return { status: "nothing", heldBack };
    const batch = { key: "2026-11-19T02:12:00.000Z", payday: data.payday, count: ready.length, tradies: data.ready.tradies, totalCents: data.ready.totalCents, status: "EXPORTED" as const, paidAt: null };
    const rest = data.rows.filter((item) => item.blockers.length) as (QueuedPayoutRow & { grossCents: number })[];
    setData(build(rest, [batch, ...data.batches]));
    return { status: "exported", batch, csv: SAMPLE_CSV, filename: "payroll-2026-11-20-151200.csv", heldBack };
  }

  async function markPaid(key: string): Promise<MarkPaidResult> {
    const batch = data?.batches.find((item) => item.key === key);
    if (!data || !batch) return { status: "not-found" };
    if (batch.status === "PAID") return { status: "already-paid", batch };
    const paid = { ...batch, status: "PAID" as const, paidAt: "2026-11-20T01:00:00.000Z" };
    setData({ ...data, batches: data.batches.map((item) => (item.key === key ? paid : item)) });
    return { status: "paid", batch: paid, notified: batch.tradies };
  }

  return (
    <OfficePayouts
      data={data}
      loading={state === "loading"}
      state={state}
      initialNotice={notice}
      exportPayroll={exportPayroll}
      markPaid={markPaid}
      downloadHref={downloadHref}
      refresh={() => {}}
    />
  );
}
