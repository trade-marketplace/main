import { z } from "zod";

// "Can't make it" (#147, DECISIONS.md "Handing a job back").
export const RELEASE_REASONS = ["Sick or hurt", "Emergency", "Double-booked", "The job is bigger than it looked", "Something else"] as const;
export type ReleaseReason = typeof RELEASE_REASONS[number];
export const releaseInputSchema = z.object({
  reason: z.enum(RELEASE_REASONS, { error: "Pick a reason." }),
  note: z.string().trim().max(500, "Keep it under 500 characters.").optional(),
}).strict();
export type ReleaseInput = z.infer<typeof releaseInputSchema>;
export type ReleaseResult =
  | { status: "released" }
  | { status: "invalid"; message: string }
  | { status: "extra-work" | "changed" | "forbidden" | "unavailable" };

/** Booked for today or tomorrow in New Zealand: handing it back now leaves the customer short, so the office is told. */
export function bookedSoon(bookedDate: Date | null, now: Date): boolean {
  if (!bookedDate) return false;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const tomorrow = new Date(`${today}T00:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const booked = bookedDate.toISOString().slice(0, 10);
  return booked === today || booked === tomorrow.toISOString().slice(0, 10);
}

export const RELEASE_WORDS = {
  open: "Can’t make it",
  title: "Hand this job back?",
  body: (customer: string) => `${customer} is told, and the job goes back on the board for another tradie.`,
  soon: "It’s booked for today or tomorrow, so the office will be told too.",
  reason: "Why?",
  note: "Anything else? (optional)",
  keep: "Keep the job",
  confirm: "Hand it back",
  done: "Job handed back.",
  extraWork: "This job has extra work on it. Message us to hand it back.",
  changed: "This job changed. Reload and try again.",
  error: "Couldn’t hand it back. Try again.",
} as const;
