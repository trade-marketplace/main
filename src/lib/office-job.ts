// The office's job admin view (#171, F05, pages.html w-o-job): what the page shows, what the office can do from it
// and the rules for each action. Pure and safe on server and browser: no database, no secrets. The reads are in
// src/server/office/job.ts, the changes in src/server/office/job-mutations.ts. Docs: docs/components/office-job.md.
import { type JobStatus, JOB_STATUSES, statusPill } from "@/lib/job-status";

export const OFFICE_JOB_PATH = "/admin/jobs";

/** Longest note or reason the office can leave on an action. It is stored on the timeline. */
export const NOTE_MAX = 500;
export const MESSAGE_MAX = 2000;

// ---------------------------------------------------------------- What the page shows

/** Who did something, for the timeline's coloured dots (design note 4). */
export type TimelineActor = "customer" | "tradie" | "office" | "system";

export const ACTOR_LABELS: Record<TimelineActor, string> = {
  customer: "Customer",
  tradie: "Tradie",
  office: "Office",
  system: "System",
};

export type TimelineEntry = {
  id: string;
  actor: TimelineActor;
  /** "Sarah", "Matt". Empty for the system. */
  actorName: string | null;
  /** "Extra work approved + paid". */
  title: string;
  /** The note the office left, or any other detail line. */
  detail: string | null;
  /** ISO time, for the `<time>` element. */
  at: string;
  /** "11:40 today", "Tue 9:02": made on the server so the browser never re-computes it. */
  when: string;
};

export type PayrollState = { label: string; kind: "waiting" | "good" | "done" | "info" };

export type MoneyView = {
  /** Paid by the customer so far (job, extra work and quick look), before refunds. */
  paidCents: number;
  /** Approved extra work, incl GST. */
  extraWorkCents: number;
  /** Given back so far. */
  refundedCents: number;
  /** What the tradie earns before extra work (gross pay from the job's frozen pricing). Empty until priced. */
  tradieEarnsCents: number | null;
  payroll: PayrollState;
};

/** A payment the office can refund (design note 3). */
export type RefundablePayment = {
  id: string;
  /** "Job", "Extra work" or "Quick look". */
  label: string;
  amountCents: number;
  /** What is left to give back. */
  refundableCents: number;
};

export type MessageView = {
  id: string;
  /** Who it is from: "Sarah Thompson", or "Office". */
  from: string;
  /** True for the office's own messages (shown on the right). */
  fromOffice: boolean;
  body: string;
  at: string;
  when: string;
};

export type PersonView = { id: string; name: string };

export type OfficeJobView = {
  id: string;
  /** "TM-1005". */
  number: string;
  title: string;
  status: JobStatus;
  /** "Electrical". */
  trade: string;
  suburb: string;
  customer: PersonView;
  tradie: PersonView | null;
  /** What the customer pays, incl GST. Empty until priced. */
  priceCents: number | null;
  /** The time and materials the price was built from, for Edit price. Empty until priced. */
  pricing: { minutes: number; materialsCents: number } | null;
  money: MoneyView;
  payments: RefundablePayment[];
  messages: MessageView[];
  /** Newest first. */
  timeline: TimelineEntry[];
  /** Tradies who could take the job over (reassign). */
  reassignOptions: PersonView[];
};

// ---------------------------------------------------------------- What the office can do

export const JOB_ACTIONS = ["reassign", "refund", "price", "status", "cancel"] as const;
export type JobActionName = (typeof JOB_ACTIONS)[number];

export const JOB_ACTION_LABELS: Record<JobActionName, string> = {
  reassign: "Reassign tradie",
  refund: "Refund (full or part)",
  price: "Edit price",
  status: "Force status",
  cancel: "Cancel job",
};

/** Statuses a job can be (re)priced in. Matches src/server/pricing/price-job.ts and the database. */
const PRICEABLE: readonly JobStatus[] = ["REVIEW", "QUOTE_BOUNTY", "PRICED"];
/** Statuses where the tradie on the job can be swapped. */
const REASSIGNABLE: readonly JobStatus[] = ["ASSIGNED", "SUBMITTED", "CANCEL_REVIEW"];
const CLOSED: readonly JobStatus[] = ["COMPLETED", "CANCELLED"];

/** Why an action can't be used right now, or null when it can. Shown beside the greyed-out menu item. */
export function actionBlocked(action: JobActionName, job: Pick<OfficeJobView, "status" | "tradie" | "payments">): string | null {
  switch (action) {
    case "reassign":
      if (!job.tradie) return "No tradie yet";
      return REASSIGNABLE.includes(job.status) ? null : "Not at this stage";
    case "refund":
      return job.payments.some((payment) => payment.refundableCents > 0) ? null : "Nothing to refund";
    case "price":
      return PRICEABLE.includes(job.status) ? null : "Locked once paid";
    case "status":
      return null;
    case "cancel":
      return CLOSED.includes(job.status) ? "Already closed" : null;
  }
}

/** The statuses the office may force this job into (never the current one). A status that needs a tradie or a price is left out when the job has none. */
export function forceStatusOptions(job: Pick<OfficeJobView, "status" | "tradie" | "priceCents">): { value: JobStatus; label: string }[] {
  return JOB_STATUSES.filter((status) => {
    if (status === job.status) return false;
    if (!job.tradie && (status === "ASSIGNED" || status === "SUBMITTED" || status === "COMPLETED")) return false;
    if (job.priceCents === null && status !== "REVIEW" && status !== "QUOTE_BOUNTY" && status !== "CANCELLED" && status !== "CANCEL_REVIEW") {
      return false;
    }
    return true;
  }).map((status) => ({ value: status, label: statusPill(status, "office")?.label ?? status }));
}

export type JobActionInput =
  | { action: "reassign"; jobId: string; seenStatus: JobStatus; workerId: string; note: string }
  | { action: "refund"; jobId: string; seenStatus: JobStatus; paymentId: string; mode: "full" | "partial"; amountCents: number | null; note: string }
  | { action: "price"; jobId: string; seenStatus: JobStatus; minutes: number; materialsCents: number; note: string }
  | { action: "status"; jobId: string; seenStatus: JobStatus; to: JobStatus; note: string }
  | { action: "cancel"; jobId: string; seenStatus: JobStatus; note: string }
  | { action: "message"; jobId: string; body: string };

/** Why an action didn't go through. */
export type JobActionError =
  | "invalid" // a field is missing or wrong (see `field`)
  | "not-found"
  | "changed" // the job moved on while the dialog was open
  | "not-allowed" // the rules don't allow it from this status
  | "unavailable"; // something broke on our side

export type JobActionResult =
  | { ok: true }
  | { ok: false; error: JobActionError; message: string; field?: string };

export const ACTION_MESSAGES = {
  noteRequired: "Add a note. It goes on the timeline.",
  noteTooLong: `Keep the note under ${NOTE_MAX} characters.`,
  changed: "This job changed while you were looking. Reload the page and try again.",
  notFound: "We can’t find that job.",
  unavailable: "Couldn’t save that. Nothing was changed. Try again.",
} as const;

const failure = (field: string, message: string): ParsedAction => ({ ok: false, error: "invalid", field, message });
export type ParsedAction = { ok: true; input: JobActionInput } | { ok: false; error: "invalid"; field: string; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** "148", "$148.00", "1,248.5" to whole cents. Null when it isn't a plain amount. */
export function parseMoneyToCents(value: string): number | null {
  const cleaned = value.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** "2", "2.5", "0.75" hours to whole minutes. Null when it isn't a plain number. */
export function parseHoursToMinutes(value: string): number | null {
  const cleaned = value.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 60);
}

/**
 * Checks what the browser sent before anything is read or changed: never trust it. Every action but a message
 * needs a note (design note 2: "a required note, stored in the timeline").
 */
export function parseJobAction(raw: unknown): ParsedAction {
  const data = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const jobId = text(data.jobId);
  if (!UUID.test(jobId)) return failure("jobId", ACTION_MESSAGES.notFound);

  if (data.action === "message") {
    const body = text(data.body);
    if (!body) return failure("body", "Write a message first.");
    if (body.length > MESSAGE_MAX) return failure("body", `Keep the message under ${MESSAGE_MAX} characters.`);
    return { ok: true, input: { action: "message", jobId, body } };
  }

  const action = JOB_ACTIONS.find((name) => name === data.action);
  if (!action) return failure("action", ACTION_MESSAGES.unavailable);
  const seenStatus = JOB_STATUSES.find((status) => status === data.seenStatus);
  if (!seenStatus) return failure("seenStatus", ACTION_MESSAGES.changed);
  const note = text(data.note);
  if (!note) return failure("note", ACTION_MESSAGES.noteRequired);
  if (note.length > NOTE_MAX) return failure("note", ACTION_MESSAGES.noteTooLong);
  const base = { jobId, seenStatus, note };

  switch (action) {
    case "cancel":
      return { ok: true, input: { action, ...base } };
    case "reassign": {
      const workerId = text(data.workerId);
      if (!UUID.test(workerId)) return failure("workerId", "Pick a tradie.");
      return { ok: true, input: { action, ...base, workerId } };
    }
    case "status": {
      const to = JOB_STATUSES.find((status) => status === data.to);
      if (!to) return failure("to", "Pick a status.");
      return { ok: true, input: { action, ...base, to } };
    }
    case "price": {
      const minutes = typeof data.minutes === "number" && Number.isInteger(data.minutes) ? data.minutes : null;
      if (minutes === null || minutes < 1 || minutes > 60 * 200) return failure("hours", "Enter the hours, like 2 or 2.5.");
      const materialsCents = typeof data.materialsCents === "number" && Number.isInteger(data.materialsCents) ? data.materialsCents : null;
      if (materialsCents === null || materialsCents < 0 || materialsCents > 100_000_000) {
        return failure("materials", "Enter the materials cost, like 120 or 0.");
      }
      return { ok: true, input: { action, ...base, minutes, materialsCents } };
    }
    case "refund": {
      const paymentId = text(data.paymentId);
      if (!UUID.test(paymentId)) return failure("paymentId", "Pick a payment.");
      const mode = data.mode === "full" || data.mode === "partial" ? data.mode : null;
      if (!mode) return failure("mode", "Choose a full or part refund.");
      let amountCents: number | null = null;
      if (mode === "partial") {
        amountCents = typeof data.amountCents === "number" && Number.isInteger(data.amountCents) ? data.amountCents : null;
        if (amountCents === null || amountCents < 1) return failure("amount", "Enter an amount to refund, like 50.00.");
      }
      return { ok: true, input: { action, ...base, paymentId, mode, amountCents } };
    }
  }
}

// ---------------------------------------------------------------- Words

/** "$372.00" (incl GST). */
export function money(cents: number): string {
  return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", currencyDisplay: "narrowSymbol" }).format(cents / 100);
}

/** "TM-1005". */
export const jobNumber = (value: number) => `TM-${value}`;

const NZ = "Pacific/Auckland";

/**
 * When something happened, in New Zealand time: "11:40 today", "Tue 9:02" within the last week, else "3 Nov, 9:02".
 */
export function whenLabel(at: Date, now: Date): string {
  const day = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: NZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const clock = new Intl.DateTimeFormat("en-NZ", { timeZone: NZ, hour: "numeric", minute: "2-digit", hour12: false }).format(at).replace(/^24:/, "0:");
  const time = clock.replace(/^0(\d:)/, "$1");
  if (day(at) === day(now)) return `${time} today`;
  const ageDays = (now.getTime() - at.getTime()) / 86_400_000;
  if (ageDays >= 0 && ageDays < 6) {
    const weekday = new Intl.DateTimeFormat("en-NZ", { timeZone: NZ, weekday: "short" }).format(at);
    return `${weekday} ${time}`;
  }
  const date = new Intl.DateTimeFormat("en-NZ", { timeZone: NZ, day: "numeric", month: "short" }).format(at);
  return `${date}, ${time}`;
}

export function fullName(person: { firstName: string; lastName: string | null }): string {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- The timeline's words

/** What an audit entry or status change reads as on the timeline. Unknown actions are made readable, never dropped. */
export type TimelineFacts = {
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** Names of people the entry mentions, by profile id. */
  names: ReadonlyMap<string, string>;
};

const num = (value: unknown): number | null => (typeof value === "number" ? value : null);

function statusWords(value: unknown): string {
  const status = JOB_STATUSES.find((candidate) => candidate === value);
  return status ? (statusPill(status, "office")?.label ?? status) : "another status";
}

export function timelineTitle({ action, before, after, names }: TimelineFacts): string {
  const worker = typeof after?.workerId === "string" ? names.get(after.workerId) : undefined;
  switch (action) {
    case "job.posted":
      return "Posted";
    case "job.priced":
    case "job.price_sent": {
      const price = num(after?.priceCents);
      return price === null ? "Price sent to the customer" : `Priced ${money(price)}`;
    }
    case "job.paid":
      return "Paid";
    case "job.claimed":
      return worker ? `Claimed by ${worker}` : "Claimed";
    case "job.submitted":
      return "Sent for sign-off";
    case "job.completed":
    case "job.signed_off":
      return "Signed off";
    case "job.auto_completed":
    case "job.auto_signed_off":
      return "Signed off automatically";
    case "job.cancel_requested":
      return "Cancellation requested";
    case "job.cancelled":
      return "Cancelled by the office";
    case "job.cancel_approved":
      return "Cancellation approved";
    case "job.reinstated":
      return "Reinstated";
    case "job.reassigned":
      return worker ? `Reassigned to ${worker}` : "Reassigned";
    case "job.unassigned":
      return "Tradie taken off the job";
    case "job.bounty_posted":
    case "job.sent_to_bounty":
      return "Sent to AI pricing review";
    case "job.price_declined":
      return "Price declined";
    case "job.status_changed":
    case "job.status_overridden":
      return `Status forced to ${statusWords(after?.status)}`;
    case "payment.created":
      return "Payment started";
    case "payment.paid": {
      const amount = num(after?.amountCents);
      return amount === null ? "Payment received" : `Paid ${money(amount)}`;
    }
    case "payment.failed":
      return "Payment failed";
    case "payment.refunded":
    case "payment.partially_refunded": {
      const given = (num(after?.refundedCents) ?? 0) - (num(before?.refundedCents) ?? 0);
      const word = action === "payment.refunded" ? "Refunded" : "Part refund";
      return given > 0 ? `${word} ${money(given)}` : word;
    }
    case "variation.priced": {
      const price = num(after?.priceCents);
      return price === null ? "Extra work priced" : `Extra work priced ${money(price)}`;
    }
    case "variation.approved":
      return "Extra work approved";
    case "variation.declined":
      return "Extra work declined";
    case "payout.queued":
      return "Payout queued";
    case "payout.adjusted":
      return "Payout adjusted";
    case "payout.exported":
      return "Payout sent to payroll";
    case "payout.paid":
      return "Payout paid";
    default: {
      const words = action.replace(/^[a-z_]+\./, "").replace(/_/g, " ");
      return words.charAt(0).toUpperCase() + words.slice(1);
    }
  }
}

/** The pill for payroll, from the tradie's payout row (or the job's stage when there isn't one). */
export function payrollState(payout: "QUEUED" | "EXPORTED" | "PAID" | null, status: JobStatus): PayrollState {
  if (payout === "PAID") return { label: "Paid", kind: "done" };
  if (payout === "EXPORTED") return { label: "Sent to payroll", kind: "info" };
  if (payout === "QUEUED") return { label: "Queued", kind: "good" };
  if (status === "CANCELLED") return { label: "No payout", kind: "waiting" };
  return { label: "After sign-off", kind: "waiting" };
}
