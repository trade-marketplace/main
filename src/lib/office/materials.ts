// The Materials card on the office job admin (#512): what the server hands the card, what the office sends back when
// it decides an over-budget spend, and the card's words. Pure: no database, no clock; safe on server and browser.
// The money rules are in src/lib/materials-repayment.ts.
import { money, parseMoneyToCents } from "@/lib/office-job";

export type OfficeMaterialsDecision = {
  /** "approved": the full spend. "changed": a set amount, up to the spend. */
  kind: "approved" | "changed";
  repaidCents: number;
  /** First name of the office user who decided. */
  by: string | null;
  at: string;
  when: string;
  note: string | null;
};

export type OfficeMaterialsView = {
  budgetCents: number;
  /** Null until the tradie reports it at finish. */
  spentCents: number | null;
  /** The receipt, as a signed link that expires (office only). url null when it couldn't be signed. Null: none. */
  receipt: { url: string | null } | null;
  /** The tradie's reason for going over budget. */
  reason: string | null;
  /**
   * not-reported: nothing reported yet. auto: within budget, repaid automatically. to-check: over budget, payout held.
   * decided: the office approved the spend or changed the amount.
   */
  state: "not-reported" | "auto" | "to-check" | "decided";
  /** What is repaid with the lead's payout (0 while held or nothing). */
  repaidCents: number;
  /** The decision that counts (the newest one for the current spend). */
  decision: OfficeMaterialsDecision | null;
  /** The lead's payout has gone to payroll: the amount is final. */
  sent: boolean;
  /** Approve spend / Change amount are offered: over budget, reported, and not sent to payroll yet. */
  canDecide: boolean;
};

export type MaterialsDecisionInput =
  | { jobId: string; kind: "approve"; seenSpentCents: number; note: string }
  | { jobId: string; kind: "change"; seenSpentCents: number; repaidCents: number; note: string };

export type MaterialsDecisionResult =
  | { ok: true; repaidCents: number }
  | { ok: false; error: "invalid" | "not-allowed" | "changed" | "not-found" | "unavailable"; message: string; field?: "amount" | "note" };

export const MATERIALS_MESSAGES = {
  note: "Add a note for the timeline.",
  amount: "Enter an amount of $0 or more.",
  notFound: "This job isn’t there any more.",
  changed: "The spend changed while you were looking. Check it again.",
  electrical: "Electrical materials go on the Telfer account. Nothing to repay.",
  withinBudget: "This spend is within budget, so it’s repaid automatically.",
  notReported: "The tradie hasn’t reported a spend yet.",
  sent: "This payout has gone to payroll, so the amount can’t change.",
  unavailable: "Couldn’t save that. Nothing was changed. Try again.",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTE_MAX = 500;

type Parsed = { ok: true; input: MaterialsDecisionInput } | { ok: false; field: "amount" | "note" | "form"; message: string };

/** Checks what the browser sent before anything is read. The server checks the amount against the spend again. */
export function parseMaterialsDecision(raw: unknown): Parsed {
  if (typeof raw !== "object" || raw === null) return { ok: false, field: "form", message: MATERIALS_MESSAGES.unavailable };
  const value = raw as Record<string, unknown>;
  const jobId = typeof value.jobId === "string" && UUID.test(value.jobId) ? value.jobId : null;
  const seen = typeof value.seenSpentCents === "number" && Number.isInteger(value.seenSpentCents) && value.seenSpentCents >= 0 ? value.seenSpentCents : null;
  if (!jobId || seen === null || (value.kind !== "approve" && value.kind !== "change")) return { ok: false, field: "form", message: MATERIALS_MESSAGES.unavailable };
  const amount = value.kind === "change"
    ? typeof value.repaidCents === "number" && Number.isInteger(value.repaidCents) && value.repaidCents >= 0 ? value.repaidCents : null
    : 0;
  if (amount === null) return { ok: false, field: "amount", message: MATERIALS_MESSAGES.amount };
  if (value.kind === "change" && amount > seen) return { ok: false, field: "amount", message: `Enter up to ${money(seen)}, the spend.` };
  const note = typeof value.note === "string" ? value.note.trim() : "";
  if (!note) return { ok: false, field: "note", message: MATERIALS_MESSAGES.note };
  if (note.length > NOTE_MAX) return { ok: false, field: "note", message: `Keep the note to ${NOTE_MAX} characters.` };
  return value.kind === "approve"
    ? { ok: true, input: { jobId, kind: "approve", seenSpentCents: seen, note } }
    : { ok: true, input: { jobId, kind: "change", seenSpentCents: seen, repaidCents: amount, note } };
}

/** What the "Change amount" field sends: cents, or null when it isn't a plain amount. */
export const amountToCents = (text: string) => parseMoneyToCents(text);

/** The "Repaid" line on the card. */
export function repaidLabel(view: OfficeMaterialsView): string {
  switch (view.state) {
    case "not-reported":
      return "Not reported yet";
    case "auto":
      return `${money(view.repaidCents)} · within budget`;
    case "to-check":
      return "Held until checked";
    case "decided":
      return view.decision?.kind === "changed" ? `${money(view.repaidCents)} · amount changed` : `${money(view.repaidCents)} · approved`;
  }
}
