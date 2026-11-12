import type { JobStatus, TimeOfDay } from "@/generated/prisma/client";
import type { PillKind } from "@/lib/job-status";

export const MY_WORK_COLUMNS = ["to-book", "on-now", "waiting-sign-off", "done"] as const;
export type MyWorkColumn = typeof MY_WORK_COLUMNS[number];
export const MY_WORK_LABELS: Record<MyWorkColumn, string> = { "to-book": "To book", "on-now": "On now", "waiting-sign-off": "Waiting sign-off", done: "Done" };
export type MyWorkQuery = { tab: "jobs" | "quotes"; column: MyWorkColumn };
export type MyWorkJob = {
  id: string; jobNumber: number; title: string; suburb: string; status: "ASSIGNED" | "SUBMITTED" | "COMPLETED" | "CANCEL_REVIEW";
  bookedDate: string | null; bookedTime: TimeOfDay | null; claimedAt: string | null; submittedAt: string | null; completedAt: string | null;
  earnCents: number | null; openProblems: number; openExtraWork: number; payout: "Queued" | "Paid";
};
export type MyWorkData = { columns: Record<MyWorkColumn, MyWorkJob[]>; counts: Record<MyWorkColumn, number>; jobsOn: number; autoReleaseHours: number };
export type MyQuote = { id: string; jobId: string; title: string; suburb: string; sentAt: string; outcome: "Priced" | "Taken by you" | "Not taken" | "Waiting"; canOpen: boolean };
export type MyQuotesData = { rows: MyQuote[]; total: number };
type Search = Record<string, string | string[] | undefined>;
export function parseMyWorkQuery(input: Search): MyWorkQuery {
  return { tab: input.tab === "quotes" ? "quotes" : "jobs", column: MY_WORK_COLUMNS.find(column => column === input.column) ?? "to-book" };
}
export function myWorkHref(query: MyWorkQuery): string {
  const params = new URLSearchParams();
  if (query.tab === "quotes") params.set("tab", "quotes");
  if (query.column !== "to-book") params.set("column", query.column);
  return `/dashboard${params.size ? `?${params}` : ""}`;
}
/** Null leaves the pre-existing customer dashboard return parser in charge. */
export function myWorkReturn(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/dashboard")) return null;
  try {
    const url = new URL(value, "https://work.invalid");
    if (url.origin !== "https://work.invalid" || url.pathname !== "/dashboard") return null;
    const tab = url.searchParams.get("tab"), column = url.searchParams.get("column");
    if (tab && tab !== "jobs" && tab !== "quotes") return null;
    if (tab !== "quotes" && !MY_WORK_COLUMNS.some(item => item === column)) return null;
    return myWorkHref(parseMyWorkQuery({ tab: tab ?? undefined, column: column ?? undefined }));
  } catch { return null; }
}
export function myWorkColumn(job: Pick<MyWorkJob, "status" | "bookedDate" | "bookedTime">): MyWorkColumn {
  if (job.status === "COMPLETED") return "done";
  if (job.status === "SUBMITTED") return "waiting-sign-off";
  return job.status === "CANCEL_REVIEW" || job.bookedDate !== null && job.bookedTime !== null ? "on-now" : "to-book";
}
export function hoursLeft(submittedAt: string | null, autoReleaseHours: number, now = new Date()): number | null {
  if (!submittedAt || !Number.isFinite(Date.parse(submittedAt))) return null;
  return Math.max(0, Math.ceil((Date.parse(submittedAt) + autoReleaseHours * 3_600_000 - now.getTime()) / 3_600_000));
}
export function myWorkPill(job: MyWorkJob, autoReleaseHours: number, now = new Date()): { label: string; kind: PillKind } {
  if (job.status === "COMPLETED") return { label: job.payout, kind: job.payout === "Paid" ? "done" : "waiting" };
  if (job.status === "CANCEL_REVIEW") return { label: "On hold", kind: "waiting" };
  if (job.status === "SUBMITTED") {
    const hours = hoursLeft(job.submittedAt, autoReleaseHours, now);
    return { label: job.openProblems ? "Paused" : hours === null ? "Waiting sign-off" : `${hours}h left`, kind: "waiting" };
  }
  if (myWorkColumn(job) === "to-book") return { label: "Book a time", kind: "action" };
  return { label: job.openExtraWork ? "Waiting on OK" : "Booked in", kind: job.openExtraWork ? "waiting" : "good" };
}
const day = (date: string, options: Intl.DateTimeFormatOptions, zone = "Pacific/Auckland") => new Intl.DateTimeFormat("en-NZ", { timeZone: zone, ...options }).format(new Date(date)).replaceAll(",", "");
const localDay = (date: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(date));
export function myWorkSecondLine(job: MyWorkJob, now = new Date()): string {
  if (job.status === "COMPLETED") return job.completedAt ? `${job.suburb} · ${day(job.completedAt, { day: "numeric", month: "short" })}` : job.suburb;
  if (job.status === "SUBMITTED") return job.submittedAt ? `${job.suburb} · done ${day(job.submittedAt, { weekday: "short" })}` : job.suburb;
  if (job.bookedDate && job.bookedTime) return `${job.suburb} · ${day(job.bookedDate, { weekday: "short", day: "numeric", month: "short" }, "UTC")} · ${{ MORNING: "Morning", AFTERNOON: "Afternoon", EVENING: "Evening" }[job.bookedTime]}`;
  return job.claimedAt ? `${job.suburb} · claimed ${localDay(job.claimedAt) === localDay(now.toISOString()) ? "today" : day(job.claimedAt, { weekday: "short", day: "numeric", month: "short" })}` : job.suburb;
}
export function quoteOutcome(status: JobStatus, workerId: string | null, viewerId: string): MyQuote["outcome"] {
  if (workerId === viewerId) return "Taken by you";
  if (workerId || status === "CANCELLED") return "Not taken";
  return status === "REVIEW" || status === "QUOTE_BOUNTY" ? "Waiting" : "Priced";
}
export const MY_WORK_STATES = ["full", "empty", "one-column", "waiting-ok", "on-hold", "paused", "queued-and-paid", "quotes", "quotes-empty", "error", "offline", "loading"] as const;
export type MyWorkState = typeof MY_WORK_STATES[number];
