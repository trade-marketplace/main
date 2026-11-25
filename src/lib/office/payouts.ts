// The office Payouts page (#175, F10) and the payroll export (#166): the shapes the server hands the page, and the
// words and numbers it shows. Pure: no database, no clock; safe on server and browser.
//
// A batch is the payouts one export sent to payroll: they share one `exportedAt` (set in the export's own
// transaction), so the batch's key is that time. Paydays are the Earnings page's (src/lib/earnings.ts): queued
// payouts belong to the next Friday, an exported batch to the first Friday on or after its export. The office and
// the tradie therefore always name the same payday.
//
// These are records: nothing here moves money. Payroll pays; the office then marks the batch paid.
import { dayMonth, formatCents, nextPayday, nzDay, weekdayDayMonth } from "@/lib/earnings";

export const PAYOUTS_PATH = "/admin/payouts";
export const PAYOUTS_EXPORT_PATH = "/admin/payouts/export";
/** How many past batches the page lists, newest first. */
export const PAYOUT_BATCH_LIMIT = 12;

/**
 * Why a queued payout is held back: what payroll is missing for the tradie (checkPayrollDetails in
 * src/server/payouts/queue-payout.ts), or "materials" when the job's materials spend is over budget and the office
 * hasn't checked it yet (#512, src/server/payouts/materials.ts).
 */
export type PayoutBlocker = "ird" | "bank" | "taxCode" | "review" | "materials";

/** A queued payout: in the next export, or held back because payroll is missing details. */
export type QueuedPayoutRow = {
  id: string;
  tradie: string;
  jobId: string;
  /** "TM-1005". */
  jobNumber: string;
  title: string;
  /** When the job was signed off and the payout queued (ISO). */
  signedOffAt: string;
  minutes: number;
  holidayPayCents: number;
  /** Materials repaid with this payout (#512): 0 when none, or while they are held for checking. */
  materialsCents: number;
  /** gross + holiday pay + materials. */
  totalCents: number;
  /** Empty when the payout goes in the next export. */
  blockers: PayoutBlocker[];
};

/** One export: the payouts sent to payroll together. */
export type PayoutBatch = {
  /** The batch's `exportedAt` (ISO), which is also its key. */
  key: string;
  /** "2026-11-21": the payday it was sent for. */
  payday: string;
  count: number;
  tradies: number;
  totalCents: number;
  /** EXPORTED until the office marks it paid. */
  status: "EXPORTED" | "PAID";
  paidAt: string | null;
};

export type OfficePayoutsData = {
  /** The next payday, "2026-11-21". */
  payday: string;
  /** Queued payouts the next export sends: count, total (materials included), holiday pay and how many tradies. */
  ready: { count: number; tradies: number; totalCents: number; grossCents: number; holidayPayCents: number; materialsCents: number };
  /** Tradies whose queued payouts are held back for missing payroll details. */
  blocked: { tradies: number; payouts: number; names: string[] };
  /** Jobs whose over-budget materials the office still has to check: their lead's payout is held back (#512). */
  materials: { payouts: number; jobs: { jobId: string; jobNumber: string }[] };
  /** Every queued payout: ready ones and held ones, oldest sign-off first. */
  rows: QueuedPayoutRow[];
  /** Recent batches, newest first. */
  batches: PayoutBatch[];
};

export type ExportPayrollResult =
  /** heldBack counts every payout left queued; materialsHeld those of them held for materials to check (#512). */
  | { status: "exported"; batch: PayoutBatch; csv: string; filename: string; heldBack: number; materialsHeld?: number }
  /** Nothing ready to send (nothing queued, or everyone queued is held back). Nothing changed. */
  | { status: "nothing"; heldBack: number; materialsHeld?: number }
  | { status: "forbidden" | "unavailable" };

export type MarkPaidResult =
  | { status: "paid"; batch: PayoutBatch; notified: number }
  /** Somebody (or an earlier click) already marked it. Nothing changed. */
  | { status: "already-paid"; batch: PayoutBatch }
  | { status: "not-found" | "forbidden" | "unavailable" };

/** Preview states for /dev/components/office-payouts. */
export const PAYOUT_STATES = ["queued", "blockers", "materials", "nothing-queued", "exported", "mark-paid", "paid", "error", "offline", "loading"] as const;
export type PayoutsState = (typeof PAYOUT_STATES)[number];

// ---- Words and numbers -------------------------------------------------------------------------------------

export const money = (cents: number) => formatCents(cents);
/** "Fri 21 Nov". */
export const paydayLabel = (day: string) => weekdayDayMonth(day);
/** The payday a batch exported at this moment is for (Earnings: the first Friday on or after the export). */
export const paydayOfExport = (exportedAt: string | Date) => nextPayday(nzDay(exportedAt));
/** The next payday from now, for the queued batch. */
export const nextPaydayFrom = (now: Date) => nextPayday(nzDay(now));
/** "Mon 3 Nov", from an ISO moment, in New Zealand time. */
export const dayLabel = (moment: string) => weekdayDayMonth(nzDay(moment));
/** "31 Oct". */
export const shortDay = (moment: string) => dayMonth(nzDay(moment));

/** Hours as the mockup shows them: "6.0", "5.5", "0.33". Exact to the minute where one decimal can't be. */
export function hoursLabel(minutes: number): string {
  return (minutes / 60).toFixed(minutes % 6 === 0 ? 1 : 2);
}

/** Hours for payroll: minutes ÷ 60 to four places, trailing zeros dropped ("6", "5.5", "0.3333"). */
export function csvHours(minutes: number): string {
  return String(Number((minutes / 60).toFixed(4)));
}

/** Dollars for payroll: "410.00", no symbol or thousands separator. */
export const csvDollars = (cents: number) => (cents / 100).toFixed(2);

export const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The blocker for a payout held until the office checks an over-budget materials receipt (#512). */
export const MATERIALS_BLOCKER = "Materials to check";
/** What payroll is missing for a tradie: every blocker but materials. */
export const payrollBlockers = (blockers: readonly PayoutBlocker[]) => blockers.filter((blocker) => blocker !== "materials");

/** The pill on a held-back payout: materials to check first (the office can act on it), then what payroll is missing. */
export function blockerLabel(blockers: readonly PayoutBlocker[]): string {
  if (blockers.includes("materials")) return MATERIALS_BLOCKER;
  if (blockers.includes("bank")) return "No bank details";
  if (blockers.includes("ird")) return "No IRD number";
  if (blockers.includes("taxCode")) return "No tax code";
  return "Needs payroll review";
}

/** "Mere R": first name and last initial, as office KPIs name people. */
export function shortName(person: { firstName: string; lastName: string | null }): string {
  const initial = person.lastName?.trim() ? ` ${Array.from(person.lastName.trim())[0]}` : "";
  return `${person.firstName.trim()}${initial}`;
}

/** The note under "Missing payroll details": who is held back. */
export function blockedNote(blocked: OfficePayoutsData["blocked"]): string {
  if (blocked.tradies === 0) return "Nobody held back";
  const shown = blocked.names.slice(0, 2).join(", ");
  const more = blocked.tradies > 2 ? ` +${blocked.tradies - 2}` : "";
  return `${shown}${more} · ${blocked.tradies === 1 ? "blocks payout" : "block payouts"}`;
}

/** The share of gross the batch's holiday pay is ("8%"), or "—" with nothing in the batch. */
export function holidayShare(ready: OfficePayoutsData["ready"]): string {
  if (ready.grossCents <= 0) return "—";
  const percent = (ready.holidayPayCents / ready.grossCents) * 100;
  return `${Number(percent.toFixed(1))}%`;
}

/** The oldest batch still waiting to be marked paid: the one "Mark batch paid" acts on. */
export function awaitingBatch(batches: readonly PayoutBatch[]): PayoutBatch | null {
  const waiting = batches.filter((batch) => batch.status === "EXPORTED");
  return waiting.length ? waiting.reduce((oldest, batch) => (batch.key < oldest.key ? batch : oldest)) : null;
}

export function batchDownloadHref(key: string, base = PAYOUTS_EXPORT_PATH): string {
  return `${base}?batch=${encodeURIComponent(key)}`;
}

/** A batch key from the URL: an ISO time this app wrote, nothing else. */
export function parseBatchKey(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) || new Date(time).toISOString() !== value ? null : value;
}

/** "payroll-2026-11-21-1512.csv": the payday, then the export's New Zealand time, so two batches never clash. */
export function batchFilename(batch: Pick<PayoutBatch, "key" | "payday">): string {
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Pacific/Auckland", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .format(new Date(batch.key))
    .replaceAll(":", "");
  return `payroll-${batch.payday}-${time}.csv`;
}
