// Payroll export and mark paid (#166) and the office Payouts page's read (#175, F10).
//
// Until a payroll provider is chosen (#65), the export is a plain CSV for whoever runs payroll (DECISIONS.md,
// "Payroll export"): one row per payout with the tradie's name and email, the job number, hours, rate, gross,
// holiday pay, total and the payout id. Never an IRD number, bank account or tax code: those stay encrypted in
// payroll_details and are entered in payroll from there. A tradie whose payroll details aren't complete
// (checkPayrollDetails) is held back: their payouts stay QUEUED and go in a later export once the details are in.
//
// Every write is office only (the role is read again inside the transaction), takes one advisory lock so two office
// users exporting or marking paid at once run one after the other, locks the payout rows it changes and only moves
// rows that are still in the status it read (QUEUED → EXPORTED, EXPORTED → PAID), and writes one audit entry per
// payout in the same transaction. The database's own trigger refuses any move backwards or any change to amounts
// once exported (schema 3). Amounts are never recalculated here: they were frozen when the job was signed off (#164).
import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { jobNumberLabel } from "@/lib/office-jobs";
import {
  PAYOUT_BATCH_LIMIT,
  batchFilename,
  csvDollars,
  csvHours,
  nextPaydayFrom,
  parseBatchKey,
  paydayOfExport,
  shortName,
  type ExportPayrollResult,
  type MarkPaidResult,
  type OfficePayoutsData,
  type PayoutBatch,
  type PayoutBlocker,
  type QueuedPayoutRow,
} from "@/lib/office/payouts";
import { createAudit } from "@/server/audit/audit";
import { databaseSchema } from "@/server/database-client";
import { createNotify } from "@/server/notifications/notify";
import { csvCell } from "@/server/office/jobs";
import { checkPayrollDetails } from "@/server/payouts/queue-payout";
import type { JobViewer } from "@/server/views";

/** pg_advisory_xact_lock(166, 1): every export and mark-paid runs one at a time. */
const LOCK = [166, 1] as const;

type Reader = Pick<Prisma.TransactionClient, "payout" | "profile">;

const PAYOUT_SELECT = {
  id: true,
  workerId: true,
  minutes: true,
  rateCents: true,
  grossCents: true,
  holidayPayCents: true,
  status: true,
  createdAt: true,
  exportedAt: true,
  paidAt: true,
  job: { select: { id: true, jobNumber: true, title: true } },
  worker: {
    select: {
      firstName: true,
      lastName: true,
      email: true,
      // Read only to tell whether payroll has them (checkPayrollDetails); never copied anywhere.
      payrollDetails: { select: { irdNumberEncrypted: true, bankAccountEncrypted: true, taxCode: true, kiwiSaverRatePct: true } },
    },
  },
} as const satisfies Prisma.PayoutSelect;

type PayoutWithPeople = Prisma.PayoutGetPayload<{ select: typeof PAYOUT_SELECT }>;

const fullName = (person: { firstName: string; lastName: string | null }) =>
  [person.firstName.trim(), person.lastName?.trim()].filter(Boolean).join(" ");
const totalOf = (payout: { grossCents: number; holidayPayCents: number }) => payout.grossCents + payout.holidayPayCents;
const blockersOf = (payout: PayoutWithPeople): PayoutBlocker[] => checkPayrollDetails(payout.worker.payrollDetails).missing;

async function isAdmin(db: Pick<Reader, "profile">, viewer: JobViewer): Promise<boolean> {
  if (viewer.role !== "ADMIN" || !viewer.userId) return false;
  const person = await db.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } });
  return person?.role === "ADMIN";
}

function payoutsRelation(db: object): string {
  return `"${databaseSchema(db).replaceAll('"', '""')}".payouts`;
}

const readQueued = (db: Reader) =>
  db.payout.findMany({ where: { status: "QUEUED" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: PAYOUT_SELECT });

function batchOf(key: string, payouts: readonly Pick<PayoutWithPeople, "workerId" | "grossCents" | "holidayPayCents" | "status" | "paidAt">[]): PayoutBatch {
  const waiting = payouts.some((payout) => payout.status === "EXPORTED");
  const paid = payouts.flatMap((payout) => (payout.paidAt ? [payout.paidAt.getTime()] : []));
  return {
    key,
    payday: paydayOfExport(key),
    count: payouts.length,
    tradies: new Set(payouts.map((payout) => payout.workerId)).size,
    totalCents: payouts.reduce((sum, payout) => sum + totalOf(payout), 0),
    status: waiting ? "EXPORTED" : "PAID",
    paidAt: !waiting && paid.length ? new Date(Math.max(...paid)).toISOString() : null,
  };
}

/** Recent batches (newest first), plus every batch still waiting to be marked paid however old it is. */
async function readBatches(db: Reader): Promise<PayoutBatch[]> {
  const sent = { status: { in: ["EXPORTED", "PAID"] } } satisfies Prisma.PayoutWhereInput;
  const [recent, waiting] = await Promise.all([
    db.payout.groupBy({ by: ["exportedAt"], where: sent, orderBy: { exportedAt: "desc" }, take: PAYOUT_BATCH_LIMIT }),
    db.payout.groupBy({ by: ["exportedAt"], where: { status: "EXPORTED" }, orderBy: { exportedAt: "desc" } }),
  ]);
  const keys = [...new Set([...recent, ...waiting].flatMap((row) => (row.exportedAt ? [row.exportedAt.getTime()] : [])))];
  if (!keys.length) return [];
  const groups = await db.payout.groupBy({
    by: ["exportedAt", "status", "workerId"],
    where: { ...sent, exportedAt: { in: keys.map((time) => new Date(time)) } },
    _count: { _all: true },
    _sum: { grossCents: true, holidayPayCents: true },
    _max: { paidAt: true },
  });
  return keys
    .sort((a, b) => b - a)
    .map((time) => {
      const rows = groups.filter((group) => group.exportedAt?.getTime() === time);
      const waitingRows = rows.some((group) => group.status === "EXPORTED");
      const paid = rows.flatMap((group) => (group._max.paidAt ? [group._max.paidAt.getTime()] : []));
      const key = new Date(time).toISOString();
      return {
        key,
        payday: paydayOfExport(key),
        count: rows.reduce((sum, group) => sum + group._count._all, 0),
        tradies: new Set(rows.map((group) => group.workerId)).size,
        totalCents: rows.reduce((sum, group) => sum + (group._sum.grossCents ?? 0) + (group._sum.holidayPayCents ?? 0), 0),
        status: waitingRows ? "EXPORTED" : "PAID",
        paidAt: !waitingRows && paid.length ? new Date(Math.max(...paid)).toISOString() : null,
      } satisfies PayoutBatch;
    });
}

/** The Payouts page: the next batch, who is held back, and recent batches. Null for anyone but the office. */
export async function loadOfficePayouts(db: PrismaClient, viewer: JobViewer, now: Date = new Date()): Promise<OfficePayoutsData | null> {
  if (!(await isAdmin(db, viewer))) return null;
  const [queued, batches] = await Promise.all([readQueued(db), readBatches(db)]);
  const rows: QueuedPayoutRow[] = queued.map((payout) => ({
    id: payout.id,
    tradie: fullName(payout.worker),
    jobId: payout.job.id,
    jobNumber: jobNumberLabel(payout.job.jobNumber),
    title: payout.job.title,
    signedOffAt: payout.createdAt.toISOString(),
    minutes: payout.minutes,
    holidayPayCents: payout.holidayPayCents,
    totalCents: totalOf(payout),
    blockers: blockersOf(payout),
  }));
  const ready = queued.filter((payout) => blockersOf(payout).length === 0);
  const held = queued.filter((payout) => blockersOf(payout).length > 0);
  const heldPeople = new Map(held.map((payout) => [payout.workerId, shortName(payout.worker)]));
  return {
    payday: nextPaydayFrom(now),
    ready: {
      count: ready.length,
      tradies: new Set(ready.map((payout) => payout.workerId)).size,
      totalCents: ready.reduce((sum, payout) => sum + totalOf(payout), 0),
      grossCents: ready.reduce((sum, payout) => sum + payout.grossCents, 0),
      holidayPayCents: ready.reduce((sum, payout) => sum + payout.holidayPayCents, 0),
    },
    blocked: { tradies: heldPeople.size, payouts: held.length, names: [...heldPeople.values()] },
    rows,
    batches,
  };
}

// ---- The CSV ----------------------------------------------------------------------------------------------------

export type PayrollCsvRow = Pick<PayoutWithPeople, "id" | "minutes" | "rateCents" | "grossCents" | "holidayPayCents"> & {
  worker: { firstName: string; lastName: string | null; email: string };
  job: { jobNumber: number };
};

/** The columns, in order. Nothing from payroll_details: no IRD number, bank account or tax code. */
export const PAYROLL_CSV_COLUMNS: readonly [header: string, value: (row: PayrollCsvRow) => string][] = [
  ["Tradie", (row) => fullName(row.worker)],
  ["Email", (row) => row.worker.email],
  ["Job number", (row) => jobNumberLabel(row.job.jobNumber)],
  ["Hours", (row) => csvHours(row.minutes)],
  ["Rate (NZD per hour)", (row) => csvDollars(row.rateCents)],
  ["Gross (NZD)", (row) => csvDollars(row.grossCents)],
  ["Holiday pay (NZD)", (row) => csvDollars(row.holidayPayCents)],
  ["Total (NZD)", (row) => csvDollars(totalOf(row))],
  ["Payout id", (row) => row.id],
];

/** A byte-order mark, so a spreadsheet reads macrons in names (Rāwiri) as UTF-8. */
export const CSV_BOM = "\uFEFF";

/** One row per payout, grouped by tradie (then job number) so payroll enters each person once. */
export function payrollCsv(rows: readonly PayrollCsvRow[]): string {
  const sorted = [...rows].sort(
    (a, b) => fullName(a.worker).localeCompare(fullName(b.worker), "en-NZ") || a.worker.email.localeCompare(b.worker.email) || a.job.jobNumber - b.job.jobNumber,
  );
  const lines = [PAYROLL_CSV_COLUMNS.map(([header]) => csvCell(header)).join(",")];
  for (const row of sorted) lines.push(PAYROLL_CSV_COLUMNS.map(([, value]) => csvCell(value(row))).join(","));
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}

// ---- Export ---------------------------------------------------------------------------------------------------

/**
 * Sends every queued payout whose tradie's payroll details are complete to payroll: marks them EXPORTED with one
 * `exportedAt` and builds the CSV, in one transaction, so a payout is in the file exactly when it is marked.
 * Held-back payouts stay QUEUED. Two exports at once: the second waits for the first and finds nothing left.
 */
export async function exportPayroll(db: PrismaClient, viewer: JobViewer, now: Date = new Date()): Promise<ExportPayrollResult> {
  if (viewer.role !== "ADMIN" || !viewer.userId) return { status: "forbidden" };
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK[0]}::int, ${LOCK[1]}::int)`;
      if (!(await isAdmin(tx, viewer))) return { status: "forbidden" } as const;
      await tx.$queryRawUnsafe(`SELECT id FROM ${payoutsRelation(db)} WHERE status = 'QUEUED' FOR UPDATE`);
      const queued = await readQueued(tx);
      const ready = queued.filter((payout) => blockersOf(payout).length === 0);
      const heldBack = queued.length - ready.length;
      if (!ready.length) return { status: "nothing", heldBack } as const;

      // A batch is known by its exportedAt, so a new one never shares the time of an earlier one.
      const latest = await tx.payout.aggregate({ _max: { exportedAt: true } });
      const exportedAt = new Date(Math.max(now.getTime(), (latest._max.exportedAt?.getTime() ?? 0) + 1));
      const changed = await tx.payout.updateMany({
        where: { id: { in: ready.map((payout) => payout.id) }, status: "QUEUED" },
        data: { status: "EXPORTED", exportedAt },
      });
      if (changed.count !== ready.length) throw new Error("Payroll export: payouts changed while exporting.");

      const audit = createAudit(tx);
      for (const payout of ready) {
        await audit(viewer, "payout.exported", { type: "payouts", id: payout.id },
          { status: payout.status, exportedAt: null }, { status: "EXPORTED", exportedAt });
      }
      const key = exportedAt.toISOString();
      const batch = batchOf(key, ready.map((payout) => ({ ...payout, status: "EXPORTED" as const, paidAt: null })));
      return { status: "exported", batch, csv: payrollCsv(ready), filename: batchFilename(batch), heldBack } as const;
    }, { timeout: 30_000 });
  } catch (error) {
    console.error("Payroll export failed; nothing was marked exported.", error);
    return { status: "unavailable" };
  }
}

/** A batch's CSV again (Download CSV on the batches list). Reads only. Null when there's no such batch. */
export async function loadBatchCsv(db: PrismaClient, viewer: JobViewer, key: unknown): Promise<{ csv: string; filename: string } | null> {
  const batchKey = parseBatchKey(key);
  if (!batchKey || !(await isAdmin(db, viewer))) return null;
  const payouts = await db.payout.findMany({
    where: { exportedAt: new Date(batchKey), status: { in: ["EXPORTED", "PAID"] } },
    select: { id: true, workerId: true, minutes: true, rateCents: true, grossCents: true, holidayPayCents: true, status: true, paidAt: true,
      worker: { select: { firstName: true, lastName: true, email: true } }, job: { select: { jobNumber: true } } },
  });
  if (!payouts.length) return null;
  return { csv: payrollCsv(payouts), filename: batchFilename(batchOf(batchKey, payouts)) };
}

// ---- Mark paid --------------------------------------------------------------------------------------------------

/**
 * Payroll has paid a batch: marks its EXPORTED payouts PAID with one paidAt, audits each, and tells each tradie
 * once (payout.paid, one notification per tradie per batch, keyed by the batch so a retry never sends a second).
 * Only EXPORTED payouts move; a batch already marked paid is left alone.
 */
export async function markBatchPaid(db: PrismaClient, viewer: JobViewer, key: unknown, now: Date = new Date()): Promise<MarkPaidResult> {
  const batchKey = parseBatchKey(key);
  if (viewer.role !== "ADMIN" || !viewer.userId) return { status: "forbidden" };
  if (!batchKey) return { status: "not-found" };
  const exportedAt = new Date(batchKey);
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK[0]}::int, ${LOCK[1]}::int)`;
      if (!(await isAdmin(tx, viewer))) return { status: "forbidden" } as const;
      await tx.$queryRawUnsafe(
        `SELECT id FROM ${payoutsRelation(db)} WHERE exported_at = $1::timestamptz AND status IN ('EXPORTED', 'PAID') FOR UPDATE`,
        batchKey,
      );
      const payouts = await tx.payout.findMany({
        where: { exportedAt, status: { in: ["EXPORTED", "PAID"] } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, workerId: true, grossCents: true, holidayPayCents: true, status: true, paidAt: true },
      });
      if (!payouts.length) return { status: "not-found" } as const;
      const waiting = payouts.filter((payout) => payout.status === "EXPORTED");
      if (!waiting.length) return { status: "already-paid", batch: batchOf(batchKey, payouts) } as const;

      const changed = await tx.payout.updateMany({
        where: { id: { in: waiting.map((payout) => payout.id) }, status: "EXPORTED" },
        data: { status: "PAID", paidAt: now },
      });
      if (changed.count !== waiting.length) throw new Error("Mark paid: payouts changed while marking.");

      const audit = createAudit(tx);
      for (const payout of waiting) {
        await audit(viewer, "payout.paid", { type: "payouts", id: payout.id },
          { status: "EXPORTED", paidAt: null }, { status: "PAID", paidAt: now });
      }
      const perTradie = new Map<string, number>();
      for (const payout of waiting) perTradie.set(payout.workerId, (perTradie.get(payout.workerId) ?? 0) + 1);
      await createNotify(tx)(
        "payout.paid",
        [...perTradie].map(([userId, count]) => ({ userId, payload: { payouts: count } })),
        { eventId: `payout.paid:${batchKey}`, payload: { batch: batchKey } },
      );
      const after = payouts.map((payout) => (payout.status === "EXPORTED" ? { ...payout, status: "PAID" as const, paidAt: now } : payout));
      return { status: "paid", batch: batchOf(batchKey, after), notified: perTradie.size } as const;
    }, { timeout: 30_000 });
  } catch (error) {
    console.error("Mark batch paid failed; nothing was marked paid.", error);
    return { status: "unavailable" };
  }
}
