// The job tracker's steps for each status (WEBAPP_SPEC C06/C07/C12/C22 for customers, D09/D11 for tradies; the
// steps and notes are from pages.html and screens.html). Pass the result to <Tracker>.
// Safe on server and browser: no secrets, no database, and no money (the price lives in the price block).
import type { Audience, JobStatus, PayoutStatus } from "./job-status";

export type TrackerStep = {
  label: string;
  /** A short line under the label, e.g. "Finding someone local". */
  note?: string;
};

export type TrackerModel = {
  steps: readonly TrackerStep[];
  /** The step happening now. `steps.length` means every step is done. */
  current: number;
};

export type TrackerOptions = {
  /** ASSIGNED with extra work waiting on the customer's OK. */
  extraWork?: boolean;
  /** Customer side: the tradie who claimed it ("Jack Wilson"). */
  tradieName?: string;
  /** Tradie side: the customer's first name ("Waiting on Sarah to approve extra work"). */
  customerFirstName?: string;
  /** Tradie side: electrical jobs need a CoC; other trades send photos (FRONTEND_SPEC "Job done"). */
  evidence?: "coc" | "photos";
  /** Tradie side, COMPLETED: where their pay is. */
  payout?: PayoutStatus | null;
};

const clean = (text: string | undefined) => text?.trim() || undefined;

/** Before paying: the whole journey. Once paid the earlier steps fold into "Price accepted" (C12). */
function customerTracker(status: JobStatus, options: TrackerOptions): TrackerModel | null {
  const sorted: TrackerStep = { label: "Sorted" };
  const tradie = { label: "Tradie confirmed", note: clean(options.tradieName) };
  switch (status) {
    case "REVIEW":
      return {
        steps: [
          { label: "Posted" },
          { label: "Getting your price", note: "We’ll let you know when it’s ready." },
          { label: "Accept & pay" },
          { label: "Tradie on the way" },
          sorted,
        ],
        current: 1,
      };
    case "QUOTE_BOUNTY":
      return {
        steps: [
          { label: "Posted" },
          { label: "Quick look", note: "A tradie visits" },
          { label: "Accept & pay" },
          { label: "Tradie on the way" },
          sorted,
        ],
        current: 1,
      };
    case "PRICED":
      return {
        steps: [{ label: "Posted" }, { label: "Price ready" }, { label: "Accept & pay" }, { label: "Tradie on the way" }, sorted],
        current: 2,
      };
    case "BOOKABLE":
      return {
        steps: [
          { label: "Posted" },
          { label: "Price accepted" },
          { label: "Tradie on the way", note: "Finding someone local" },
          sorted,
        ],
        current: 2,
      };
    case "ASSIGNED":
      return {
        steps: [
          { label: "Price accepted" },
          options.extraWork ? { label: "Tradie confirmed", note: "Extra work needs your OK" } : tradie,
          sorted,
        ],
        current: 1,
      };
    case "SUBMITTED":
      return {
        steps: [{ label: "Price accepted" }, tradie, { label: "Please check", note: "Within 48 hours" }, sorted],
        current: 2,
      };
    case "COMPLETED":
      return { steps: [{ label: "Price accepted" }, tradie, sorted], current: 3 };
    case "CANCEL_REVIEW":
    case "CANCELLED":
      // The pill says it; there is no designed tracker for a cancelled job.
      return null;
  }
}

/** The job workspace (D09): only once the tradie has claimed the job. */
function tradieTracker(status: JobStatus, options: TrackerOptions): TrackerModel | null {
  const name = clean(options.customerFirstName);
  const steps: TrackerStep[] = [
    { label: "Claimed" },
    options.extraWork
      ? { label: "Do the work", note: `Waiting on ${name ?? "the customer"} to approve extra work` }
      : { label: "Do the work" },
    { label: options.evidence === "photos" ? "Upload photos" : "Upload CoC" },
    { label: "Customer signs off", note: "or 48 hours" },
    { label: "Paid", note: "Next payroll" },
  ];
  switch (status) {
    case "ASSIGNED":
      return { steps, current: 1 };
    case "SUBMITTED":
      return { steps, current: 3 };
    case "COMPLETED":
      return { steps, current: options.payout === "PAID" ? steps.length : 4 };
    default:
      // Not claimed yet (or on hold / cancelled): the job page shows the pill and its own actions instead.
      return null;
  }
}

/**
 * The tracker for a job, or null when that audience has none for this status. The office has no tracker: its
 * job page shows the audit timeline instead (F05).
 */
export function jobTracker(status: JobStatus, audience: Audience, options: TrackerOptions = {}): TrackerModel | null {
  if (audience === "customer") return customerTracker(status, options);
  if (audience === "tradie") return tradieTracker(status, options);
  return null;
}
