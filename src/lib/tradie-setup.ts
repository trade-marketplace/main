// Tradie home: the setup checklist new tradies see at /jobs until they're set up (D01, #132). Pure, so the server,
// the screen and the dev preview all read one list. Wording is the mockup's (w-t-onboard). Every step's state comes
// from saved facts (src/server/workers/setup.ts); nothing here decides who may claim a job.
import { boardHref, type BoardQuery } from "@/lib/job-board";

export type SetupStepId = "email" | "trades" | "licence" | "bank" | "photo" | "area";
/** done: struck through. checking: the office is looking at it. todo: the tradie's move. */
export type SetupStepState = "done" | "checking" | "todo";
/** none: no restricted trade, so no licence step. Rejected and expired licences go back to the tradie. */
export type LicenceFact = "none" | "done" | "checking" | "rejected" | "expired";
export type SetupFacts = {
  emailVerified: boolean; tradeLabels: string[]; licence: LicenceFact;
  bankComplete: boolean; hasPhoto: boolean; hasWorkArea: boolean;
  /** The job board would show jobs right now (the board's own rules, not re-made here). */
  canBrowse: boolean;
};
export type SetupStep = { id: SetupStepId; state: SetupStepState; title: string; caption: string | null; problem: string | null; action: { label: string; href: string } | null };
export type TradieSetup = { steps: SetupStep[]; done: number; total: number; complete: boolean; canBrowse: boolean; licenceChecking: boolean;
  /** When the server read the facts (ISO). The screen re-reads them when it is shown again from the browser's history. */
  checkedAt: string };
export type TradieSetupResult = { ok: true; setup: TradieSetup } | { ok: false };

export const SETUP_HOME = "/jobs";
/** The phone's existing "All jobs" marker: the board itself, also before setup is finished. */
export const BROWSE_JOBS_HREF = "/jobs?view=all";
/** Settings pages take the way back in `next` and show their "Back to jobs" link. */
const settings = (path: string) => `${path}?next=${encodeURIComponent(SETUP_HOME)}`;
export const SETUP_LINKS = { email: settings("/verify"), trades: settings("/profile/trades"), licence: settings("/profile/trades"), bank: settings("/profile/payroll"), photo: settings("/profile"), area: settings("/profile/area") } as const satisfies Record<SetupStepId, string>;

export function buildTradieSetup(facts: SetupFacts, now = new Date()): TradieSetup {
  const step = (id: SetupStepId, done: boolean, title: string, caption: string | null, label: string, more: Partial<SetupStep> = {}): SetupStep =>
    ({ id, state: done ? "done" : "todo", title, caption, problem: null, action: done ? null : { label, href: SETUP_LINKS[id] }, ...more });
  const steps: SetupStep[] = [
    step("email", facts.emailVerified, "Verify your email", facts.emailVerified ? "Done" : null, "Send the link again"),
    step("trades", facts.tradeLabels.length > 0, "Add your trades", facts.tradeLabels.join(", ") || null, "Add"),
  ];
  // Other-only tradies need no licence, so they get no licence step (#132 "What if they only do Other work?").
  if (facts.licence === "checking") steps.push(step("licence", false, "Licence check", "Usually 1 working day. We’ll email you.", "", { state: "checking", action: null }));
  else if (facts.licence !== "none") steps.push(step("licence", facts.licence === "done", "Licence check", facts.licence === "done" ? "Done" : null, facts.licence === "rejected" ? "Try again" : "Update",
    { problem: facts.licence === "rejected" ? "Rejected" : facts.licence === "expired" ? "Expired" : null }));
  steps.push(
    step("bank", facts.bankComplete, "Add bank account & IRD number", "So we can pay you through payroll", "Add"),
    step("photo", facts.hasPhoto, "Add a profile photo", "Customers like to see who’s coming", "Upload"),
    step("area", facts.hasWorkArea, "Set your work area & job alerts", "Get pinged about jobs near you", "Add"),
  );
  const done = steps.filter(item => item.state === "done").length;
  return { steps, done, total: steps.length, complete: done === steps.length, canBrowse: facts.canBrowse, licenceChecking: facts.licence === "checking", checkedAt: now.toISOString() };
}

/** Plain /jobs is the checklist until setup is complete. Any chosen board view (All jobs, a filter, the map) is the board. */
export function showsSetupHome(setup: Pick<TradieSetup, "complete">, query: BoardQuery): boolean {
  return !setup.complete && boardHref(query) === SETUP_HOME;
}
export const setupCount = (setup: Pick<TradieSetup, "done" | "total">) => `${setup.done} of ${setup.total}`;
export const setupBannerLabel = (setup: Pick<TradieSetup, "done" | "total">) => `Finish setup (${setup.done}/${setup.total})`;
