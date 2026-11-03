import type { JobDraft, JobSchedule } from "./job-draft";

export type JobTimeWindow = NonNullable<JobDraft["timeWindows"]>[number];
export const DAY_PARTS = [{ value: "MORNING", label: "Morning" }, { value: "AFTERNOON", label: "Afternoon" }, { value: "EVENING", label: "Evening" }] as const;

/** The existing #116 contract is Auckland calendar dates; day-part clock boundaries are not specified. */
export function postingDateRange(now: Date) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const last = new Date(`${today}T00:00:00Z`); last.setUTCDate(last.getUTCDate() + 6);
  return { today, last: last.toISOString().slice(0, 10) };
}

export function postingDays(now: Date) {
  const { today } = postingDateRange(now);
  const label = new Intl.DateTimeFormat("en-NZ", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${today}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + index); const value = date.toISOString().slice(0, 10);
    return { value, label: label.format(date), windows: DAY_PARTS.map(part => ({ value: `${value}/${part.value}`, label: part.label })) };
  });
}

export const timeWindowKey = (window: JobTimeWindow) => `${window.date}/${window.timeOfDay}`;
export function selectedTimeWindows(values: readonly string[], now: Date): JobTimeWindow[] {
  return postingDays(now).flatMap(day => DAY_PARTS.flatMap(part => values.includes(`${day.value}/${part.value}`) ? [{ date: day.value, timeOfDay: part.value }] : []));
}
export function timeWindowsInRange(windows: readonly JobTimeWindow[], now: Date) {
  const { today, last } = postingDateRange(now); return windows.every(window => window.date >= today && window.date <= last);
}
/** Explicit Any time keeps its flexible semantics and fills the currently offered seven days on save. */
export function currentSchedule(value: Pick<JobDraft, "asap" | "anyTime" | "timeWindows">, now: Date): JobSchedule {
  return { asap: value.asap ?? false, anyTime: value.anyTime ?? false, timeWindows: value.anyTime ? postingDays(now).flatMap(day => DAY_PARTS.map(part => ({ date: day.value, timeOfDay: part.value }))) : value.timeWindows ?? [] };
}
/** Any time retains #116's flexible/no-dated-window semantics. Empty legacy schedules aren't declared expired. */
export function timeWindowsExpired(windows: readonly Pick<JobTimeWindow, "date">[], anyTime: boolean, now: Date) {
  const { today } = postingDateRange(now); return !anyTime && windows.length > 0 && windows.every(window => window.date < today);
}
