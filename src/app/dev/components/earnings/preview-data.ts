// Pretend payouts for /dev/components/earnings (#165). Every name, job and amount is an example; the dates sit
// around a fixed "today" (Monday 2 November 2026) so the page, the e2e tests and the screenshots always agree.
import { buildEarnings, type EarningsView, type PayoutRecord, type WaitingJob } from "@/lib/earnings";

export const PREVIEW_NOW = new Date("2026-11-02T01:00:00Z");
export const PREVIEW_BASE = "/dev/components/earnings";

export const PREVIEW_STATES = ["default", "empty", "loading", "error", "long", "no-paid"] as const;
export type PreviewState = (typeof PREVIEW_STATES)[number];

export function isPreviewState(value: string | undefined): value is PreviewState {
  return (PREVIEW_STATES as readonly string[]).includes(value ?? "");
}

type Seed = [id: string, number: number, title: string, minutes: number, signedOff: string, paid: string | null];

// minutes × $70.00 an hour, plus 8% holiday pay: the same rule the real payout uses.
const SEEDS: Seed[] = [
  ["a1", 990, "Control panel", 300, "2026-10-29T20:00:00Z", null],
  ["a2", 981, "Heat pump circuit", 180, "2026-10-26T20:00:00Z", "2026-10-30T02:00:00Z"],
  ["a3", 982, "Rewire the workshop", 480, "2026-10-27T20:00:00Z", "2026-10-30T02:00:00Z"],
  ["a4", 983, "Outdoor double plug", 120, "2026-10-28T20:00:00Z", "2026-10-30T02:00:00Z"],
  ["a5", 970, "Smoke alarms, three rooms", 150, "2026-10-19T20:00:00Z", "2026-10-23T02:00:00Z"],
  ["a6", 971, "Switchboard upgrade", 420, "2026-10-20T20:00:00Z", "2026-10-23T02:00:00Z"],
  ["a7", 960, "Garage lights", 120, "2026-10-12T20:00:00Z", "2026-10-16T02:00:00Z"],
  ["a8", 961, "Heated towel rail", 90, "2026-10-13T20:00:00Z", "2026-10-16T02:00:00Z"],
  ["a9", 950, "Kitchen power points", 240, "2026-09-22T20:00:00Z", "2026-09-25T02:00:00Z"],
  ["b1", 940, "Sleepout wiring", 360, "2026-09-09T20:00:00Z", "2026-09-11T02:00:00Z"],
];

const RATE_CENTS = 7000;

function payout([id, number, title, minutes, signedOff, paid]: Seed, longTitle: boolean): PayoutRecord {
  const grossCents = Math.round((minutes * RATE_CENTS) / 60);
  return {
    id,
    jobNumber: `TM-${String(number).padStart(4, "0")}`,
    title: longTitle ? `${title}: replace the whole run of old cabling beside the garage and along the shared driveway` : title,
    minutes,
    rateCents: RATE_CENTS,
    grossCents,
    holidayPayCents: Math.round(grossCents * 0.08),
    status: paid ? "PAID" : "QUEUED",
    createdAt: signedOff,
    paidAt: paid,
  };
}

const WAITING: WaitingJob[] = [{ id: "w1", jobNumber: "TM-1005", title: "Sub wiring", totalCents: 25920, submitted: false }];

export function previewView(state: PreviewState): EarningsView | null {
  if (state === "error" || state === "loading") return null;
  if (state === "empty") return buildEarnings({ payouts: [], waiting: [], now: PREVIEW_NOW });
  const long = state === "long";
  const seeds = state === "no-paid" ? SEEDS.filter(([, , , , , paid]) => !paid) : SEEDS;
  return buildEarnings({ payouts: seeds.map((seed) => payout(seed, long)), waiting: WAITING, now: PREVIEW_NOW });
}
