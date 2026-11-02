// Earnings history for the demo tradie (#165, D12): finished jobs whose pay was sent in earlier weekly payrolls, so
// the Earnings page has a chart and a payroll table to show next to the one queued payout and the job waiting on
// sign-off in data.mjs. Every title and figure is an example. Dates are worked out from the day you seed (the last
// Friday and the Fridays before it), so a preview always looks current. Seeding again gives the same rows.

/** Same ids as data.mjs: fixed, so seeding again updates the same rows. */
const id = (/** @type {number} */ n) => `de000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * [number in the list, title, billed minutes, payroll (0 = the most recent Friday, 1 = the one before…), days
 * between the customer's sign-off and that payroll]. Electrical work at the licensed rate, so each payout is minutes
 * × $70.00 an hour plus 8% holiday pay, as the job was priced.
 * @type {[number, string, number, number, number][]}
 */
const HISTORY = [
  [0x101, "Heat pump circuit", 180, 0, 4],
  [0x102, "Rewire the workshop", 480, 0, 3],
  [0x103, "Outdoor power points", 120, 0, 1],
  [0x104, "Smoke alarms in three rooms", 150, 1, 4],
  [0x105, "Switchboard upgrade", 420, 1, 2],
  [0x106, "Garage lights", 120, 2, 5],
  [0x107, "Heated towel rail", 120, 2, 3],
  [0x108, "Kitchen power points", 240, 2, 1],
  [0x109, "Sleepout wiring", 360, 3, 3],
  [0x10a, "Ceiling fan install", 120, 4, 4],
  [0x10b, "Outside sensor light", 120, 4, 2],
];

/**
 * The most recent Friday's payroll, at 14:00 in New Zealand (02:00 UTC): that day if it has already happened,
 * otherwise the Friday before.
 * @param {Date} now
 */
export function lastPayroll(now) {
  const friday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 2));
  friday.setTime(friday.getTime() - ((friday.getUTCDay() - 5 + 7) % 7) * DAY_MS);
  if (friday.getTime() > now.getTime()) friday.setTime(friday.getTime() - 7 * DAY_MS);
  return friday;
}

/**
 * Completed jobs for the demo tradie, in the shape postJob takes, each with when it was signed off and paid.
 * @param {Date} now
 * @returns {(import("./data.mjs").DemoJob & { signedOffAt: Date; exportedAt: Date; paidAt: Date })[]}
 */
export function earningsHistory(now) {
  const latest = lastPayroll(now);
  return HISTORY.map(([n, title, minutes, payroll, daysBefore]) => {
    const paidAt = new Date(latest.getTime() - payroll * 7 * DAY_MS);
    return {
      id: id(0xb000 + n),
      category: "ELECTRICAL",
      title,
      description: "Finished and signed off. Part of the demo earnings history.",
      address: "home",
      postedDaysAgo: payroll * 7 + daysBefore + 8,
      photos: [{ file: "outdoor-plug.webp", by: "customer" }],
      windows: [[-(payroll * 7 + daysBefore + 2), "MORNING"]],
      estimates: [],
      pricing: { minutes, materialsCents: 0, note: "Demo earnings history." },
      worker: "tradie",
      booked: [-(payroll * 7 + daysBefore + 2), "MORNING"],
      steps: [
        ["PRICED", "office"],
        ["BOOKABLE", "customer"],
        ["ASSIGNED", "tradie"],
        ["SUBMITTED", "tradie"],
        ["COMPLETED", "customer"],
      ],
      signedOffAt: new Date(paidAt.getTime() - daysBefore * DAY_MS - 4 * HOUR_MS),
      exportedAt: new Date(paidAt.getTime() - 20 * HOUR_MS),
      paidAt,
    };
  });
}
