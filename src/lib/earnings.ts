// The tradie's Earnings page (#165, D12): turns the worker's payouts into what the page shows. Pure: no database, no
// clock (the caller passes `now`), safe on server and browser. The server (src/server/earnings/load.ts) reads the
// rows; every amount here was worked out when the job was priced and signed off (src/server/payouts, #164), so
// nothing on this page recalculates pay. The worker only ever sees what they earn, never the customer's price.
//
// Wording is exact (WEBAPP_SPEC D12): "Queued" until payroll has paid it, then "Paid". Never say money moved before
// payroll runs. A payout that has been sent to payroll (EXPORTED) is still "Queued": payroll hasn't paid it yet.
//
// Days are New Zealand days (Pacific/Auckland), weeks run Monday to Sunday, and payroll is weekly on a Friday
// (the mockups' "Fri 7 Nov"). That weekday is the one place to change if payroll moves.

export const EARNINGS_PATH = "/earnings";
export const STATEMENT_PATH = "/earnings/statement";
export const TIME_ZONE = "Pacific/Auckland";
/** Payroll runs weekly on this day (0 = Sunday … 5 = Friday). */
export const PAYROLL_WEEKDAY = 5;
export const CHART_WEEKS = 8;

/** The id of the not-yet-paid payroll in the URL (`/earnings?payroll=next`). Paid ones use their date. */
export const NEXT_PAYROLL_ID = "next";

export type PayoutRecord = {
  id: string;
  /** "TM-0990". */
  jobNumber: string;
  title: string;
  minutes: number;
  rateCents: number;
  grossCents: number;
  holidayPayCents: number;
  status: "QUEUED" | "EXPORTED" | "PAID";
  /** When the customer signed the job off and the payout was queued (ISO). */
  createdAt: string;
  /** When payroll confirmed it (ISO). Only PAID payouts have one. */
  paidAt: string | null;
};

/** A job that is on its way to a payout but not signed off yet. */
export type WaitingJob = {
  id: string;
  jobNumber: string;
  title: string;
  /** What the worker will earn once it is signed off (gross + holiday pay), worked out by the payout maths. */
  totalCents: number;
  /** The worker has sent it in and the customer hasn't signed off yet. */
  submitted: boolean;
};

/** gross + holiday pay: what the worker earns on a payout, before PAYE (same as `calculatePayout().totalCents`). */
export const payoutTotal = (payout: Pick<PayoutRecord, "grossCents" | "holidayPayCents">) =>
  payout.grossCents + payout.holidayPayCents;

export type PayoutLine = {
  id: string;
  jobNumber: string;
  title: string;
  hours: string;
  rate: string;
  gross: string;
  holidayPay: string;
  total: string;
  totalCents: number;
  /** "Mon": the day it was signed off. */
  signedOff: string;
};

export type Payroll = {
  /** `next` or the paid date ("2026-10-31"): what the URL and the row use. */
  id: string;
  /** "Fri 7 Nov". */
  label: string;
  /** "7 Nov": the title of the detail view and the phone's "Payroll 31 Oct". */
  short: string;
  status: "Queued" | "Paid";
  totalCents: number;
  lines: PayoutLine[];
};

export type Week = {
  /** The Monday, "2026-09-08". */
  start: string;
  /** "8 Sep", or "This week". */
  label: string;
  totalCents: number;
  current: boolean;
};

export type EarningsView = {
  /** "October": the month in "Paid in October". */
  month: string;
  paidThisMonth: { totalCents: number; jobs: number };
  next: { label: string; totalCents: number; jobs: number };
  waiting: { totalCents: number; jobs: number; items: WaitingJob[] };
  weeks: Week[];
  /** The next payroll first (when anything is queued), then paid ones, newest first. */
  payrolls: Payroll[];
  /** Nothing earned and nothing on its way: the Empty state. */
  isEmpty: boolean;
};

// ---- New Zealand days ---------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** The New Zealand calendar day of a moment, "2026-11-02". */
export function nzDay(moment: Date | string | number): string {
  return dayFormat.format(new Date(moment));
}

const civil = (day: string) => Date.parse(`${day}T00:00:00Z`);
export const addDays = (day: string, days: number) => new Date(civil(day) + days * DAY_MS).toISOString().slice(0, 10);
const weekdayOf = (day: string) => new Date(civil(day)).getUTCDay();
/** The Monday of the week a day is in. */
export const mondayOf = (day: string) => addDays(day, -((weekdayOf(day) + 6) % 7));
/** The next payroll day, today included. */
export const nextPayday = (today: string) => addDays(today, (PAYROLL_WEEKDAY - weekdayOf(today) + 7) % 7);

const dayNumber = (day: string) => Number(day.slice(8, 10));
const monthIndex = (day: string) => Number(day.slice(5, 7)) - 1;
/** "7 Nov". */
export const dayMonth = (day: string) => `${dayNumber(day)} ${MONTHS_SHORT[monthIndex(day)]}`;
/** "Fri 7 Nov". */
export const weekdayDayMonth = (day: string) => `${WEEKDAYS[weekdayOf(day)]} ${dayMonth(day)}`;
/** "Mon". */
export const weekdayShort = (day: string) => WEEKDAYS[weekdayOf(day)];
export const monthName = (day: string) => MONTHS_LONG[monthIndex(day)];

/** The NZ tax year (1 April to 31 March) a day is in: first and last day, and its name "2026/27". */
export function taxYearOf(day: string): { start: string; end: string; name: string } {
  const year = Number(day.slice(0, 4));
  const startYear = monthIndex(day) >= 3 ? year : year - 1;
  return {
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
    name: `${startYear}/${String(startYear + 1).slice(2)}`,
  };
}

// ---- Money and time -----------------------------------------------------------------------------------------

const nzd = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" });

/** $3,452.80, from cents. */
export function formatCents(cents: number): string {
  return nzd.format(Math.round(cents) / 100);
}

/** "2 h", "2 h 30 min", "45 min": billed time on a payout. */
export function formatHours(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export const jobsText = (count: number) => `${count} ${count === 1 ? "job" : "jobs"}`;

// ---- The view -----------------------------------------------------------------------------------------------

export function payoutLine(payout: PayoutRecord): PayoutLine {
  const totalCents = payoutTotal(payout);
  return {
    id: payout.id,
    jobNumber: payout.jobNumber,
    title: payout.title,
    hours: formatHours(payout.minutes),
    rate: `${formatCents(payout.rateCents)}/hr`,
    gross: formatCents(payout.grossCents),
    holidayPay: formatCents(payout.holidayPayCents),
    total: formatCents(totalCents),
    totalCents,
    signedOff: weekdayShort(nzDay(payout.createdAt)),
  };
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

export function buildEarnings({ payouts, waiting, now }: { payouts: readonly PayoutRecord[]; waiting: readonly WaitingJob[]; now: Date }): EarningsView {
  const today = nzDay(now);
  const month = today.slice(0, 7);

  const unpaid = payouts.filter((payout) => payout.status !== "PAID");
  const paid = payouts.filter((payout) => payout.status === "PAID" && payout.paidAt);

  const paidThisMonth = paid.filter((payout) => nzDay(payout.paidAt as string).startsWith(month));
  const payday = nextPayday(today);

  const payrolls: Payroll[] = [];
  if (unpaid.length > 0) {
    const ordered = [...unpaid].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    payrolls.push({
      id: NEXT_PAYROLL_ID,
      label: weekdayDayMonth(payday),
      short: dayMonth(payday),
      status: "Queued",
      totalCents: sum(ordered.map(payoutTotal)),
      lines: ordered.map(payoutLine),
    });
  }
  const byDay = new Map<string, PayoutRecord[]>();
  for (const payout of paid) {
    const day = nzDay(payout.paidAt as string);
    byDay.set(day, [...(byDay.get(day) ?? []), payout]);
  }
  for (const day of [...byDay.keys()].sort().reverse()) {
    const group = (byDay.get(day) as PayoutRecord[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    payrolls.push({
      id: day,
      label: weekdayDayMonth(day),
      short: dayMonth(day),
      status: "Paid",
      totalCents: sum(group.map(payoutTotal)),
      lines: group.map(payoutLine),
    });
  }

  // The chart: what was signed off in each of the last eight weeks, queued or paid, this week last.
  const thisMonday = mondayOf(today);
  const weeks: Week[] = Array.from({ length: CHART_WEEKS }, (_, index) => {
    const start = addDays(thisMonday, -7 * (CHART_WEEKS - 1 - index));
    const end = addDays(start, 6);
    const totalCents = sum(
      payouts
        .filter((payout) => {
          const day = nzDay(payout.createdAt);
          return day >= start && day <= end;
        })
        .map(payoutTotal),
    );
    const current = index === CHART_WEEKS - 1;
    return { start, label: current ? "This week" : dayMonth(start), totalCents, current };
  });

  return {
    month: monthName(today),
    paidThisMonth: { totalCents: sum(paidThisMonth.map(payoutTotal)), jobs: paidThisMonth.length },
    next: { label: weekdayDayMonth(payday), totalCents: sum(unpaid.map(payoutTotal)), jobs: unpaid.length },
    waiting: { totalCents: sum(waiting.map((job) => job.totalCents)), jobs: waiting.length, items: [...waiting] },
    weeks,
    payrolls,
    isEmpty: payouts.length === 0 && waiting.length === 0,
  };
}

/** How tall a bar is, as a percentage of the tallest (0 stays a thin stub the chart styles itself). */
export function barHeights(weeks: readonly Week[]): number[] {
  const tallest = Math.max(...weeks.map((week) => week.totalCents), 0);
  return weeks.map((week) => (tallest === 0 ? 0 : Math.round((week.totalCents / tallest) * 100)));
}

/** "Week of 8 Sep, $410.00" / "This week, $410.00": a bar's name for screen readers and its tooltip's context. */
export function weekName(week: Week): string {
  return `${week.current ? "This week" : `Week of ${week.label}`}, ${formatCents(week.totalCents)}`;
}

// ---- The URL ------------------------------------------------------------------------------------------------

/** `?state=` lets reviewers open the states that real data can't show (docs/TESTING.md). */
export const EARNINGS_STATES = ["default", "empty", "loading", "error"] as const;
export type EarningsState = (typeof EARNINGS_STATES)[number];

export type EarningsQuery = { state: EarningsState; payroll: string | null };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function parseEarningsQuery(params: Record<string, string | string[] | undefined>): EarningsQuery {
  const state = one(params.state);
  const payroll = one(params.payroll)?.trim();
  return {
    state: (EARNINGS_STATES as readonly string[]).includes(state ?? "") ? (state as EarningsState) : "default",
    payroll: payroll && (payroll === NEXT_PAYROLL_ID || /^\d{4}-\d{2}-\d{2}$/.test(payroll)) ? payroll : null,
  };
}

/** `/earnings?payroll=2026-10-31`, keeping a `?state=` flag so a reviewer's view survives opening a payroll. */
export function earningsHref(query: { state?: string; payroll?: string | null } = {}, base: string = EARNINGS_PATH): string {
  const search = new URLSearchParams();
  if (query.state && query.state !== "default") search.set("state", query.state);
  if (query.payroll) search.set("payroll", query.payroll);
  const text = search.toString();
  return text ? `${base}?${text}` : base;
}
