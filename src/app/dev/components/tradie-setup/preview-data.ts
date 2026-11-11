import { buildTradieSetup, type SetupFacts, type TradieSetupResult } from "@/lib/tradie-setup";

/** Every state of the setup checklist (#132). "pending" is the mockup (w-t-onboard): 3 of 6, licence being checked. */
export const SETUP_STATES = ["pending", "new", "other-only", "rejected", "expired", "cannot-browse", "loading", "error", "board"] as const;
export type SetupState = typeof SETUP_STATES[number];

const mockup: SetupFacts = { emailVerified: true, tradeLabels: ["Electrical", "Gas fitting"], licence: "checking", bankComplete: false, hasPhoto: false, hasWorkArea: true, canBrowse: true };
const facts: Record<Exclude<SetupState, "error">, SetupFacts> = {
  pending: mockup, loading: mockup,
  new: { emailVerified: false, tradeLabels: [], licence: "none", bankComplete: false, hasPhoto: false, hasWorkArea: false, canBrowse: false },
  "other-only": { ...mockup, tradeLabels: ["Other / general labour"], licence: "none" },
  rejected: { ...mockup, licence: "rejected" },
  expired: { ...mockup, licence: "expired", bankComplete: true },
  "cannot-browse": { ...mockup, hasWorkArea: false, canBrowse: false },
  board: { ...mockup, bankComplete: true },
};
export function previewSetup(state: SetupState): TradieSetupResult {
  return state === "error" ? { ok: false } : { ok: true, setup: buildTradieSetup(facts[state], new Date("2026-11-10T00:00:00Z")) };
}
