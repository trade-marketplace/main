import type { JobStatus, TimeOfDay, Trade } from "@/generated/prisma/client";

export const WORKSPACE_STATUSES = ["ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW"] as const;
export const WORKSPACE_STATES = ["not-booked", "booked", "electrical", "other-trade", "late-menu", "sending", "sent", "try-later", "waiting-extra", "submitted", "completed", "on-hold", "error", "offline", "loading", "load-error"] as const;
export type WorkspaceState = typeof WORKSPACE_STATES[number];
export type JobUpdateKind = "on-my-way" | "running-late" | "customer-not-home";
export type JobUpdateResult = { status: "sent" } | { status: "forbidden" | "invalid" | "unavailable" } | { status: "try-later"; retryAfter: number };
/** Explicit worker-only wire shape. Customer pricing and raw ORM records never cross this boundary. */
export type WorkspaceView = {
  id: string; jobNumber: number; title: string; description: string; category: Trade; status: JobStatus;
  earnCents: number | null; customer: { firstName: string; lastInitial: string | null; phone: string | null };
  address: string; accessNotes: string | null; bookedDate: string | null; bookedTime: TimeOfDay | null;
  budgetCents: number | null; extraWorkOpen: boolean; claimedAt: string | null;
  signOffDeadline: string | null; autoReleaseHours: number; payout: "QUEUED" | "EXPORTED" | "PAID" | null;
};
export function signOffHours(deadline: string, now = Date.now()) {
  return Math.max(0, Math.ceil((Date.parse(deadline) - now) / 3_600_000));
}
export function claimDateLabel(value: string | null, now = new Date()) {
  if (!value) return null;
  const date = new Date(value), localDay = new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" });
  return localDay.format(date) === localDay.format(now) ? "claimed today" : `claimed ${new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "short" }).format(date)}`;
}
