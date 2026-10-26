// Job status pills: one server status, three labels (docs/design/sitemap.json `job_statuses`, FRONTEND_SPEC §2).
// The list of statuses is the schema's JobStatus enum, so a status added to prisma/schema.prisma fails typecheck
// here until it has its labels. tests/unit/job-status.test.ts checks the labels against sitemap.json.
// Safe on server and browser: no secrets, no database.
import { JobStatus, PayoutStatus } from "@/generated/prisma/enums";

import type { Mode } from "./mode";

export { JobStatus, PayoutStatus };

/** Every job status, in the schema's order (the order a job moves through them). */
export const JOB_STATUSES: readonly JobStatus[] = Object.values(JobStatus);

/** Who is looking: the customer, the tradie (worker) or the office. */
export const AUDIENCES = ["customer", "tradie", "office"] as const;
export type Audience = (typeof AUDIENCES)[number];

/** The audience whose screens use each colour mode. */
export function audienceForMode(mode: Mode): Audience {
  return mode === "trade" ? "tradie" : mode;
}

/**
 * How a pill is coloured, by meaning (components.css `.tm-status--*`, web.css `.tm-status--bounty`):
 * waiting = we're on it, action = you need to act (signature colour), good, done (Forest), alert, info,
 * bounty = a gold quote bounty.
 */
export const PILL_KINDS = ["waiting", "action", "good", "done", "alert", "info", "bounty"] as const;
export type PillKind = (typeof PILL_KINDS)[number];

export type StatusPillLabel = { label: string; kind: PillKind };

/** What else the server knows about the job that changes its pill. All optional. */
export type StatusContext = {
  /** ASSIGNED with extra work (a variation) waiting on a price or the customer's OK. */
  extraWork?: boolean;
  /** ASSIGNED, tradie: the booked time is now ("On now" instead of "Message customer"). */
  onNow?: boolean;
  /** ASSIGNED, tradie: the customer's first name, for "Message Sarah". */
  customerFirstName?: string;
  /** COMPLETED, tradie: where their pay is. EXPORTED is still on its way, so it reads "Queued". */
  payout?: PayoutStatus | null;
  /** BOOKABLE, office: nobody has claimed it for more than 48 hours. */
  unclaimedOverdue?: boolean;
};

type Labels = Record<Audience, StatusPillLabel | null>;

const pill = (label: string, kind: PillKind): StatusPillLabel => ({ label, kind });

/**
 * The plain labels. `null` means that audience never sees a pill for it (sitemap "(hidden)"). Record<JobStatus>
 * makes TypeScript refuse a schema status with no labels.
 */
const LABELS: Record<JobStatus, Labels> = {
  REVIEW: {
    customer: pill("Getting your price", "waiting"),
    tradie: pill("Needs an estimate", "action"),
    office: pill("To price", "action"),
  },
  QUOTE_BOUNTY: {
    customer: pill("Needs a quick look", "action"),
    tradie: pill("Quote bounty", "bounty"),
    office: pill("AI pricing review", "action"),
  },
  PRICED: {
    customer: pill("Price ready", "action"),
    tradie: null,
    office: pill("Waiting on customer", "waiting"),
  },
  BOOKABLE: {
    customer: pill("Booked", "good"),
    tradie: pill("Ready to claim", "action"),
    office: pill("Unclaimed", "waiting"),
  },
  ASSIGNED: {
    customer: pill("Tradie confirmed", "good"),
    tradie: pill("Message customer", "action"),
    office: pill("In progress", "good"),
  },
  SUBMITTED: {
    customer: pill("Please check", "action"),
    tradie: pill("Waiting sign-off", "waiting"),
    office: pill("Sign-off", "waiting"),
  },
  COMPLETED: {
    customer: pill("Sorted", "done"),
    tradie: pill("Done", "good"),
    office: pill("Payroll", "done"),
  },
  CANCEL_REVIEW: {
    customer: pill("Cancel requested", "alert"),
    tradie: pill("On hold", "alert"),
    office: pill("Cancellation", "alert"),
  },
  CANCELLED: {
    customer: pill("Cancelled", "waiting"),
    tradie: null,
    office: pill("Closed", "waiting"),
  },
};

/** ASSIGNED + variation (sitemap "ASSIGNED + variation"). */
const EXTRA_WORK: Labels = {
  customer: pill("Needs your OK", "action"),
  tradie: pill("Waiting on approval", "waiting"),
  office: pill("Price extra work", "action"),
};

/**
 * The pill for a job: its label and colour for this audience, or null when they don't see one.
 * The server owns the status and the context; this only words it.
 */
export function statusPill(status: JobStatus, audience: Audience, context: StatusContext = {}): StatusPillLabel | null {
  const plain = LABELS[status][audience];

  if (status === "ASSIGNED") {
    if (context.extraWork) return EXTRA_WORK[audience];
    if (audience === "tradie") {
      if (context.onNow) return pill("On now", "action");
      const name = context.customerFirstName?.trim();
      if (name) return pill(`Message ${name}`, "action");
    }
  }
  if (status === "COMPLETED" && audience === "tradie" && context.payout) {
    return pill(context.payout === "PAID" ? "Done · Paid" : "Done · Queued", "good");
  }
  if (status === "BOOKABLE" && audience === "office" && context.unclaimedOverdue) {
    return pill("Unclaimed", "alert");
  }
  return plain;
}
