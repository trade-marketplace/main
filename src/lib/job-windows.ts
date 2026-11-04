import type { JobSchedule } from "./job-draft";
export type JobWindowsSnapshot = { id: string; jobNumber: number; title: string; editable: boolean; revision: string; schedule: JobSchedule };
export type SaveJobWindowsResult = { status: "saved" | "changed"; snapshot: JobWindowsSnapshot }
  | { status: "invalid"; fields: Record<string, string> } | { status: "forbidden" | "unavailable" };
