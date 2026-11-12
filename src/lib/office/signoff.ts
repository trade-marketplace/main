export const SIGNOFF_STATES = ["list", "list-empty", "review-electrical", "review-other", "over-budget", "problem-open", "flag-dialog", "flag-error", "saving", "approved", "moved-on", "changed", "files-unavailable", "error", "loading", "offline"] as const;
export type SignoffState = typeof SIGNOFF_STATES[number];
export type SignoffResult = { status: "approved" | "flagged" | "changed" | "moved-on" | "forbidden" | "unavailable" | "invalid" };
export type SignoffRow = { loadedAt?: number; id: string; number: string; title: string; worker: string; sentAt: string | null; hours: number; problem: boolean; checked: boolean };
export type SignoffListData = { loadedAt?: number; rows: SignoffRow[]; page: number; total: number };
export type SignoffView = SignoffRow & {
  revision: string | null; trade: string; customer: string; movedOn: boolean; cocNumber: string | null; cocUrl: string | null;
  photos: { id: string; url: string }[]; notes: string | null; declaration: string | null; declaredAt: string | null;
  budgetCents: number; spentCents: number | null; receiptUrl: string | null; overBudgetReason: string | null;
  checkedBy: string | null; checkedAt: string | null; filesUnavailable: boolean;
};
export function signoffClock(sentAt: string | null, hours: number, problem: boolean, now = Date.now()) {
  if (problem) return "Paused: problem reported";
  if (!sentAt) return "Not sent";
  const elapsed = Math.max(0, Math.floor((now - Date.parse(sentAt)) / 3_600_000));
  const remaining = Math.max(0, Math.ceil((Date.parse(sentAt) + hours * 3_600_000 - now) / 3_600_000));
  return `Sent ${elapsed}h ago · completes by itself in ${remaining}h`;
}
export function flagNote(note: unknown): string | null {
  return typeof note === "string" && note.trim().length >= 3 && note.trim().length <= 500 ? note.trim() : null;
}
