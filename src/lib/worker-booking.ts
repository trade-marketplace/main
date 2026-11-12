import { DAY_PARTS, postingDateRange, postingDays, type JobTimeWindow } from "./job-time-windows";
export type BookingSnapshot = { id: string; title: string; suburb: string; customerFirstName: string; windows: JobTimeWindow[]; anyTime: boolean; booked: JobTimeWindow | null; revision: string };
export type BookingResult = { status: "booked"; window: JobTimeWindow; rescheduled: boolean } | { status: "changed"; snapshot: BookingSnapshot } | { status: "invalid" | "forbidden" | "unavailable" };
export type RequestTimesResult = { status: "asked" | "forbidden" | "unavailable" };
export const BOOKING_STATES = ["pick", "any-time", "booked", "saving", "changed", "none-left", "asked", "error", "offline", "loading", "load-error"] as const;
export type BookingState = typeof BOOKING_STATES[number];
export function availableBookingWindows(windows: JobTimeWindow[], anyTime: boolean, now: Date): JobTimeWindow[] {
  const { today } = postingDateRange(now);
  return anyTime ? postingDays(now).flatMap(day => DAY_PARTS.map(part => ({ date: day.value, timeOfDay: part.value }))) : windows.filter(window => window.date >= today).sort((a, b) => a.date.localeCompare(b.date) || DAY_PARTS.findIndex(part => part.value === a.timeOfDay) - DAY_PARTS.findIndex(part => part.value === b.timeOfDay));
}
export function bookingDateLabel(date: string) { return new Intl.DateTimeFormat("en-NZ", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T00:00:00Z`)).replace(",", ""); }
export function bookingWindowLabel(window: JobTimeWindow) { return `${bookingDateLabel(window.date)} · ${DAY_PARTS.find(part => part.value === window.timeOfDay)?.label}`; }
export function bookingButtonLabel(window: JobTimeWindow | null, booked: boolean) { return window ? `${booked ? "Change to" : "Book"} ${bookingWindowLabel(window)}` : "Pick a time"; }
