import { MY_WORK_COLUMNS, myWorkColumn, type MyQuotesData, type MyWorkData, type MyWorkJob, type MyWorkState } from "@/lib/my-work";

export const PREVIEW_NOW = "2026-11-11T02:00:00Z";
const id = (number: number) => `14800000-0000-4000-8000-${String(number).padStart(12, "0")}`;
export function previewJob(number: number, change: Partial<MyWorkJob> = {}): MyWorkJob {
  return { id: id(number), jobNumber: 1000 + number, title: "Sub wiring", suburb: "Windsor", status: "ASSIGNED", bookedDate: null, bookedTime: null,
    claimedAt: PREVIEW_NOW, submittedAt: null, completedAt: null, earnCents: 25920, openExtraWork: 0, openProblems: 0, payout: "Queued", ...change };
}
export function previewWork(state: MyWorkState): MyWorkData {
  let jobs = [previewJob(1), previewJob(2, { title: "New power point", suburb: "Glengarry", bookedDate: "2026-11-12", bookedTime: "MORNING", earnCents: 9600 }),
    previewJob(3, { title: "Pump wiring", suburb: "Bluff", bookedDate: "2026-11-13", bookedTime: "AFTERNOON", openExtraWork: 1, earnCents: 23000 }),
    previewJob(4, { title: "Control panel", suburb: "Georgetown", status: "SUBMITTED", submittedAt: "2026-11-11T00:00:00Z", earnCents: 41000 }),
    ...Array.from({ length: 5 }, (_, index) => previewJob(5 + index, { title: ["Outdoor lights", "Garden gate", "Kitchen tap", "Fence repair", "Garage switch"][index], suburb: "Otatara", status: "COMPLETED", completedAt: `2026-10-${31 - index}T00:00:00Z`, payout: index % 2 ? "Paid" : "Queued", earnCents: 18800 + index * 1000 }))];
  if (state === "empty") jobs = [];
  if (state === "one-column") jobs = [jobs[0]];
  if (state === "waiting-ok") jobs = [jobs[2]];
  if (state === "on-hold") jobs = [previewJob(10, { title: "Pump wiring", status: "CANCEL_REVIEW", bookedDate: "2026-11-13", bookedTime: "MORNING" })];
  if (state === "paused") jobs = [{ ...jobs[3], openProblems: 1 }];
  const columns: MyWorkData["columns"] = { "to-book": [], "on-now": [], "waiting-sign-off": [], done: [] };
  for (const job of jobs) columns[myWorkColumn(job)].push(job);
  const counts = Object.fromEntries(MY_WORK_COLUMNS.map(column => [column, columns[column].length])) as MyWorkData["counts"];
  if (columns.done.length) counts.done = 14;
  return { columns, counts, jobsOn: counts["to-book"] + counts["on-now"], autoReleaseHours: 48 };
}
export function previewQuotes(empty = false): MyQuotesData {
  return { total: empty ? 0 : 5, rows: empty ? [] : (["Waiting", "Taken by you", "Priced", "Not taken", "Waiting"] as const).map((outcome, index) => ({
    id: id(100 + index), jobId: id(index + 1), title: ["Outdoor lights", "Sub wiring", "New socket", "Kitchen tap", "Garden fence"][index], suburb: "Windsor", sentAt: "2026-11-09T02:00:00Z", outcome,
    canOpen: outcome === "Waiting" || outcome === "Taken by you",
  })) };
}
