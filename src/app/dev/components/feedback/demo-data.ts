// Example data for /dev/components/feedback, in a plain module: the server page can't read values exported from
// a "use client" file (it only gets a reference to them). The jobs are examples.
export const DEMO_JOBS = [
  { id: "TM-1005", cat: "Electrical", title: "Replace two downlights in the hallway" },
  { id: "TM-1006", cat: "Plumbing", title: "Leaking kitchen mixer tap" },
  { id: "TM-1007", cat: "Handyman", title: "Hang a heavy mirror in the lounge" },
];

/** The usage example's states; `?state=` picks one. */
export const USAGE_STATES = ["loading", "empty", "error", "jobs"] as const;
export type UsageState = (typeof USAGE_STATES)[number];

export function isUsageState(value: unknown): value is UsageState {
  return typeof value === "string" && (USAGE_STATES as readonly string[]).includes(value);
}
