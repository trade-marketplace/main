// Cancellations and disputes (#172, F06, /admin/disputes): the office's list of open cases and the case view, where
// it reads both sides and decides. Pure and safe on server and browser: no database, no secrets. The reads are in
// src/server/office/disputes.ts, the decisions in src/server/office/dispute-decisions.ts.
//
// A case is a job that needs the office to decide: a paid job whose customer asked to cancel (CANCEL_REVIEW), or a
// job with an OPEN problem report. The decisions:
//   cancellation → "Cancel and refund" (full, or part of one payment), "Cancel, no refund", or "Keep the job going";
//                  either cancel can also pay the tradie for the part of the work they did (DECISIONS.md, #172).
//   problem      → "Resolve" with a note, and optionally a part refund. The sign-off timer then carries on.
import { JOB_STATUSES, type JobStatus } from "@/lib/job-status";
import { ACTION_MESSAGES, type JobActionError, NOTE_MAX, parseHoursToMinutes, type PayrollState, type PersonView } from "@/lib/office-job";

export const DISPUTES_PATH = "/admin/disputes";
export const DISPUTES_PAGE_SIZE = 20;

export const disputeHref = (jobId: string) => `${DISPUTES_PATH}/${encodeURIComponent(jobId)}`;

// ---------------------------------------------------------------- The list

export type DisputeKind = "cancellation" | "problem";

export type DisputeRow = {
  jobId: string;
  /** "TM-1005". */
  number: string;
  title: string;
  kinds: DisputeKind[];
  /** "Cancellation", "Problem", "Urgent problem", "Cancellation + problem". */
  kindLabel: string;
  /** The customer's reason, or the problem's topic. */
  detail: string;
  /** When the oldest open part of the case started (ISO). */
  since: string;
  /** "5m", "3h", "2d". */
  age: string;
  customer: string;
  tradie: string | null;
  /** Everything the customer paid on the job (job, extra work, quick look), before refunds. */
  paidCents: number;
  refundedCents: number;
  href: string;
};

export type DisputeListData = { rows: DisputeRow[]; total: number; page: number };

/** How long a case has waited: "new", "40m", "5h", then whole days from 48 hours ("3d"). */
export function disputeAge(since: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60_000));
  if (minutes < 1) return "new";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

export function disputeKindLabel(kinds: readonly DisputeKind[], urgent: boolean): string {
  const problem = urgent ? "Urgent problem" : "Problem";
  if (kinds.includes("cancellation") && kinds.includes("problem")) return `Cancellation + ${problem.toLowerCase()}`;
  return kinds.includes("cancellation") ? "Cancellation" : problem;
}

export function disputePage(value: unknown): number {
  const page = typeof value === "string" && /^\d{1,4}$/.test(value) ? Number(value) : 1;
  return Math.max(1, page);
}

// ---------------------------------------------------------------- The case

export type DisputePayment = {
  id: string;
  /** "Job", "Extra work" or "Quick look". */
  label: string;
  amountCents: number;
  refundedCents: number;
  /** What is left to give back. */
  refundableCents: number;
};

export type DisputeUpdate = { id: string; title: string; detail: string | null; at: string; when: string };

export type DisputePhoto = { id: string; url: string | null };

export type DisputeProblem = {
  id: string;
  topic: string;
  details: string;
  urgent: boolean;
  status: "OPEN" | "RESOLVED";
  /** Who reported it: the job's customer, or its tradie. */
  reporter: "customer" | "tradie";
  reporterName: string;
  at: string;
  when: string;
  photos: DisputePhoto[];
  /** The reporter's private conversation with the office about it. */
  threadHref: string | null;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedWhen: string | null;
};

export type DisputeCancellation = {
  /** Still waiting on the office (the job is in CANCEL_REVIEW). */
  open: boolean;
  reason: string | null;
  /** The customer asked, or the price closed after 7 days with a paid quick look (the system). */
  by: "customer" | "system";
  byName: string | null;
  at: string;
  when: string;
  /** The status the job goes back to with "Keep the job going". */
  backTo: JobStatus | null;
};

/** A decision already made on this job, newest first. */
export type DisputeDecisionEntry = { id: string; title: string; note: string | null; by: string | null; at: string; when: string };

export type DisputeMoney = {
  paidCents: number;
  refundedCents: number;
  /** Payments that were paid, with what is left on each. */
  payments: DisputePayment[];
  /** The tradie's payout for this job: Queued / Sent to payroll / Paid, or none yet. */
  payroll: PayrollState;
  /** The payout's total (gross + holiday pay) once there is one. */
  payoutCents: number | null;
  payoutMinutes: number | null;
  /** What the whole job pays the tradie (gross + holiday pay), from its frozen pricing. Empty until priced. */
  tradieEarnsCents: number | null;
  /** The frozen hourly rate, for a part payout. Empty until priced. */
  rateCents: number | null;
  /** The longest part payout: the job's priced time plus approved extra work. Zero when it can't be paid. */
  maxPartMinutes: number;
};

export type DisputeCaseView = {
  id: string;
  number: string;
  title: string;
  status: JobStatus;
  trade: string;
  suburb: string;
  customer: PersonView;
  tradie: PersonView | null;
  cancellation: DisputeCancellation | null;
  /** Open reports first, then resolved ones. */
  problems: DisputeProblem[];
  tradieSide: { updates: DisputeUpdate[]; evidence: { sentAt: string | null; sentWhen: string | null; notes: string | null; cocNumber: string | null; photos: DisputePhoto[] } | null };
  money: DisputeMoney;
  /** A payout for the tradie already exists, so a part payout can't be added. */
  hasPayout: boolean;
  decisions: DisputeDecisionEntry[];
  /** Messages on the job (the job admin view's Messages card). */
  messagesHref: string;
  jobHref: string;
  /** Photos couldn't be signed: show them as unavailable. */
  filesUnavailable: boolean;
};

/** Nothing left to decide: no cancellation request waiting and no open problem report ("Resolved"). */
export function caseResolved(view: Pick<DisputeCaseView, "cancellation" | "problems">): boolean {
  return !view.cancellation?.open && !view.problems.some((problem) => problem.status === "OPEN");
}

// ---------------------------------------------------------------- Deciding

export const CANCEL_DECISIONS = ["refund", "no-refund", "keep"] as const;
export type CancelDecision = (typeof CANCEL_DECISIONS)[number];

export const CANCEL_DECISION_LABELS: Record<CancelDecision, string> = {
  refund: "Cancel and refund",
  "no-refund": "Cancel, no refund",
  keep: "Keep the job going",
};

export type DisputeRefund =
  /** Everything left on every payment. */
  | { mode: "full" }
  /** Part of one payment. */
  | { mode: "partial"; paymentId: string; amountCents: number };

export type DisputeDecisionInput =
  | {
      kind: "cancellation";
      jobId: string;
      decision: CancelDecision;
      note: string;
      /** Made when the dialog opens and sent with every try, so trying again never refunds or pays twice. */
      requestId: string;
      /** "refund" only. */
      refund: DisputeRefund | null;
      /** Either cancel: minutes of work to pay the tradie for. Null for none. */
      partPayoutMinutes: number | null;
    }
  | {
      kind: "problem";
      jobId: string;
      reportId: string;
      /** The job's status as the office saw it, so a refund is refused if the job moved on meanwhile. */
      seenStatus: JobStatus;
      note: string;
      requestId: string;
      /** Optional: part of one payment. */
      refund: Extract<DisputeRefund, { mode: "partial" }> | null;
    };

export type DisputeResult =
  | { ok: true; message: string }
  | { ok: false; error: JobActionError; message: string; field?: string };

export const DISPUTE_MESSAGES = {
  noteRequired: ACTION_MESSAGES.noteRequired,
  noteTooLong: ACTION_MESSAGES.noteTooLong,
  changed: "This case changed while you were looking. Reload the page and try again.",
  notFound: "We can’t find that case.",
  unavailable: ACTION_MESSAGES.unavailable,
  amount: "Enter an amount to refund, like 50.00.",
  payment: "Pick a payment.",
  hours: "Enter the hours to pay, like 1.5.",
  nothingToRefund: "There’s nothing left to refund. Choose Cancel, no refund.",
  noTradie: "There’s no tradie on this job to pay.",
  notPriced: "This job was never priced, so there’s no rate to pay the tradie at.",
  hasPayout: "This tradie already has a payout for this job, so a part payout can’t be added.",
  partlyRefunded: "Some of the refund went through, but not all of it. Nothing else was changed. Try again to refund the rest.",
  refundedNotSaved: "The refund went through, but the decision wasn’t saved. Try again. It won’t be refunded twice.",
  refundedButChanged: "The refund went through, but this case changed meanwhile, so nothing else was changed. Reload the page.",
} as const;

export const DECISION_DONE: Record<CancelDecision | "resolve", string> = {
  refund: "Job cancelled and refunded.",
  "no-refund": "Job cancelled.",
  keep: "Job back on track.",
  resolve: "Problem resolved.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export type ParsedDecision = { ok: true; input: DisputeDecisionInput } | { ok: false; error: "invalid"; field: string; message: string };
const failure = (field: string, message: string): ParsedDecision & { ok: false } => ({ ok: false, error: "invalid", field, message });

/** "1.5" hours from the dialog to whole minutes, or null when the box isn't a plain number of hours. */
export const partPayoutMinutes = (hours: string) => parseHoursToMinutes(hours);

/** Checks what the browser sent before anything is read or changed: never trust it. Every decision needs a note. */
export function parseDisputeDecision(raw: unknown): ParsedDecision {
  const data = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const jobId = text(data.jobId);
  if (!UUID.test(jobId)) return failure("jobId", DISPUTE_MESSAGES.notFound);
  const requestId = text(data.requestId);
  if (!UUID.test(requestId)) return failure("requestId", DISPUTE_MESSAGES.changed);

  const parsedRefund = parseRefund(data.refund);
  if (!parsedRefund.ok) return parsedRefund;
  const refund = parsedRefund.refund;

  if (data.kind === "problem") {
    const reportId = text(data.reportId);
    if (!UUID.test(reportId)) return failure("reportId", DISPUTE_MESSAGES.notFound);
    const seenStatus = JOB_STATUSES.find((status) => status === data.seenStatus);
    if (!seenStatus) return failure("seenStatus", DISPUTE_MESSAGES.changed);
    if (refund && refund.mode !== "partial") return failure("refund", DISPUTE_MESSAGES.amount);
    const note = parseNote(data.note);
    if (typeof note !== "string") return note;
    return { ok: true, input: { kind: "problem", jobId, reportId, seenStatus, note, requestId, refund: refund ?? null } };
  }

  if (data.kind !== "cancellation") return failure("kind", DISPUTE_MESSAGES.unavailable);
  const decision = CANCEL_DECISIONS.find((name) => name === data.decision);
  if (!decision) return failure("decision", DISPUTE_MESSAGES.unavailable);
  if (decision === "refund" && !refund) return failure("mode", "Choose a full or part refund.");

  let minutes: number | null = null;
  if (decision !== "keep" && data.partPayoutMinutes !== null && data.partPayoutMinutes !== undefined) {
    minutes = typeof data.partPayoutMinutes === "number" && Number.isInteger(data.partPayoutMinutes) ? data.partPayoutMinutes : null;
    if (minutes === null || minutes < 1 || minutes > 60 * 200) return failure("hours", DISPUTE_MESSAGES.hours);
  }
  const note = parseNote(data.note);
  if (typeof note !== "string") return note;
  return {
    ok: true,
    input: { kind: "cancellation", jobId, decision, note, requestId, refund: decision === "refund" ? refund : null, partPayoutMinutes: minutes },
  };
}

function parseNote(value: unknown): string | ParsedDecision {
  const note = text(value);
  if (!note) return failure("note", DISPUTE_MESSAGES.noteRequired);
  if (note.length > NOTE_MAX) return failure("note", DISPUTE_MESSAGES.noteTooLong);
  return note;
}

function parseRefund(value: unknown): { ok: true; refund: DisputeRefund | null } | (ParsedDecision & { ok: false }) {
  if (value === null || value === undefined) return { ok: true, refund: null };
  const data = (typeof value === "object" ? value : {}) as Record<string, unknown>;
  if (data.mode === "full") return { ok: true, refund: { mode: "full" } };
  if (data.mode !== "partial") return failure("mode", "Choose a full or part refund.");
  const paymentId = text(data.paymentId);
  if (!UUID.test(paymentId)) return failure("paymentId", DISPUTE_MESSAGES.payment);
  const amountCents = typeof data.amountCents === "number" && Number.isInteger(data.amountCents) ? data.amountCents : null;
  if (amountCents === null || amountCents < 1) return failure("amount", DISPUTE_MESSAGES.amount);
  return { ok: true, refund: { mode: "partial", paymentId, amountCents } };
}

// ---------------------------------------------------------------- Previews

/** /dev/components/office-disputes?state=… */
export const DISPUTE_PREVIEW_STATES = [
  "list",
  "empty",
  "cancellation",
  "problem",
  "partial-refund",
  "decided",
  "refund-failed",
  "error",
  "offline",
  "loading",
] as const;
export type DisputePreviewState = (typeof DISPUTE_PREVIEW_STATES)[number];
