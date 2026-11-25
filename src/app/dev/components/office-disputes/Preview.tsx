"use client";
// Pretend data and a pretend server for /dev/components/office-disputes. Names, prices and times are examples.
import { useState } from "react";

import { DisputeCase, type SubmitDecision } from "@/components/office/DisputeCase";
import { DisputesList } from "@/components/office/DisputesList";
import { DisputesSkeleton } from "@/components/office/DisputesSkeleton";
import { DECISION_DONE, type DisputeCaseView, type DisputeListData, type DisputePreviewState } from "@/lib/office-disputes";

const BASE = "/dev/components/office-disputes";
const REFUSED = "Stripe didn’t make that refund. Nothing was changed. Check the payment in Stripe, then try again.";

const cancellationCase: DisputeCaseView = {
  id: "17200000-0000-4000-8000-000000000001",
  number: "TM-1005",
  title: "Replace outdoor plug",
  status: "CANCEL_REVIEW",
  trade: "Electrical",
  suburb: "Windsor",
  customer: { id: "17200000-0000-4000-8000-0000000000c1", name: "Sarah Jones" },
  tradie: { id: "17200000-0000-4000-8000-0000000000d1", name: "Jack Wilson" },
  cancellation: {
    open: true,
    reason: "We found someone who could come today. Jack only got as far as turning the power off.",
    by: "customer",
    byName: "Sarah Jones",
    at: "2026-11-23T20:10:00.000Z",
    when: "9:10 today",
    backTo: "ASSIGNED",
  },
  problems: [],
  tradieSide: {
    updates: [
      { id: "u3", title: "On my way", detail: null, at: "2026-11-23T19:40:00.000Z", when: "8:40 today" },
      { id: "u2", title: "Window booked", detail: null, at: "2026-11-22T02:00:00.000Z", when: "Sun 15:00" },
      { id: "u1", title: "Claimed", detail: null, at: "2026-11-21T22:00:00.000Z", when: "Sun 11:00" },
    ],
    evidence: null,
  },
  money: {
    paidCents: 23_400,
    refundedCents: 0,
    payments: [{ id: "17200000-0000-4000-8000-0000000000a1", label: "Job", amountCents: 23_400, refundedCents: 0, refundableCents: 23_400 }],
    payroll: { label: "After sign-off", kind: "waiting" },
    payoutCents: null,
    payoutMinutes: null,
    tradieEarnsCents: 15_120,
    rateCents: 7_000,
    maxPartMinutes: 120,
  },
  hasPayout: false,
  decisions: [],
  messagesHref: `${BASE}?state=cancellation`,
  jobHref: `${BASE}?state=cancellation`,
  filesUnavailable: false,
};

const problemCase: DisputeCaseView = {
  ...cancellationCase,
  id: "17200000-0000-4000-8000-000000000002",
  number: "TM-1006",
  title: "Fix the dripping tap",
  status: "SUBMITTED",
  trade: "Plumbing",
  suburb: "Georgetown",
  tradie: { id: "17200000-0000-4000-8000-0000000000d2", name: "Aroha Smith" },
  cancellation: null,
  problems: [
    {
      id: "17200000-0000-4000-8000-0000000000b1",
      topic: "Work not finished",
      details: "The tap still drips overnight. I’ve added a photo of the puddle in the morning.",
      urgent: false,
      status: "OPEN",
      reporter: "customer",
      reporterName: "Sarah Jones",
      at: "2026-11-23T18:00:00.000Z",
      when: "7:00 today",
      photos: [{ id: "report-photo", url: "/images/examples/switch.jpg" }],
      threadHref: `${BASE}?state=problem`,
      resolution: null,
      resolvedBy: null,
      resolvedWhen: null,
    },
  ],
  tradieSide: {
    updates: [
      { id: "u5", title: "Sent for sign-off", detail: null, at: "2026-11-22T23:00:00.000Z", when: "Mon 12:00" },
      { id: "u4", title: "On my way", detail: null, at: "2026-11-22T20:30:00.000Z", when: "Mon 9:30" },
    ],
    evidence: {
      sentAt: "2026-11-22T23:00:00.000Z",
      sentWhen: "Mon 12:00",
      notes: "Replaced the washer and the cartridge. No drips when I left.",
      cocNumber: null,
      photos: [{ id: "evidence-photo", url: "/images/examples/board.jpg" }],
    },
  },
  money: { ...cancellationCase.money, paidCents: 15_600, payments: [{ id: "17200000-0000-4000-8000-0000000000a2", label: "Job", amountCents: 15_600, refundedCents: 0, refundableCents: 15_600 }], tradieEarnsCents: 7_560 },
  messagesHref: `${BASE}?state=problem`,
  jobHref: `${BASE}?state=problem`,
};

const decidedCase: DisputeCaseView = {
  ...cancellationCase,
  status: "CANCELLED",
  cancellation: { ...cancellationCase.cancellation!, open: false },
  money: {
    ...cancellationCase.money,
    refundedCents: 11_700,
    payments: [{ id: "17200000-0000-4000-8000-0000000000a1", label: "Job", amountCents: 23_400, refundedCents: 11_700, refundableCents: 11_700 }],
    payroll: { label: "Queued", kind: "good" },
    payoutCents: 3_780,
    payoutMinutes: 30,
    maxPartMinutes: 0,
  },
  hasPayout: true,
  decisions: [
    {
      id: "d1",
      title: "Cancelled with a part refund · tradie paid for part",
      note: "Half refunded: Jack had isolated the circuit and taken the old plug off. Paid 30 minutes.",
      by: "Matt Larsen",
      at: "2026-11-23T21:00:00.000Z",
      when: "10:00 today",
    },
  ],
};

const list: DisputeListData = {
  total: 3,
  page: 1,
  rows: [
    { jobId: problemCase.id, number: "TM-1006", title: "Fix the dripping tap", kinds: ["problem"], kindLabel: "Problem", detail: "Work not finished", since: "2026-11-21T18:00:00.000Z", age: "2d", customer: "Sarah Jones", tradie: "Aroha Smith", paidCents: 15_600, refundedCents: 0, href: `${BASE}?state=problem` },
    { jobId: cancellationCase.id, number: "TM-1005", title: "Replace outdoor plug", kinds: ["cancellation"], kindLabel: "Cancellation", detail: "We found someone who could come today. Jack only got as far as turning the power off.", since: "2026-11-23T20:10:00.000Z", age: "50m", customer: "Sarah Jones", tradie: "Jack Wilson", paidCents: 23_400, refundedCents: 0, href: `${BASE}?state=cancellation` },
    { jobId: "17200000-0000-4000-8000-000000000003", number: "TM-1009", title: "Hang a new interior door in the hallway", kinds: ["cancellation", "problem"], kindLabel: "Cancellation + urgent problem", detail: "The price closed after 7 days with no answer.", since: "2026-11-23T20:40:00.000Z", age: "20m", customer: "Mere Parata", tradie: null, paidCents: 3_000, refundedCents: 0, href: `${BASE}?state=cancellation` },
  ],
};

/** The pretend server: works, or (refund-failed) answers as Stripe refusing the refund would. */
function pretend(state: DisputePreviewState): SubmitDecision {
  return async (input) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (state === "refund-failed") return { ok: false, error: "unavailable", message: REFUSED };
    const body = input as { kind: string; decision?: keyof typeof DECISION_DONE };
    return { ok: true, message: DECISION_DONE[body.kind === "problem" ? "resolve" : (body.decision ?? "refund")] };
  };
}

const resolvedProblem: DisputeCaseView = {
  ...problemCase,
  problems: problemCase.problems.map((problem) => ({ ...problem, status: "RESOLVED" as const, resolution: "Aroha is going back on Thursday to replace the tap.", resolvedBy: "Matt Larsen", resolvedWhen: "10:00 today" })),
};

export function Preview({ state }: { state: DisputePreviewState }) {
  // After a pretend decision, show the case as decided.
  const [decided, setDecided] = useState(false);
  if (state === "loading") return <DisputesSkeleton view="list" />;
  if (state === "list" || state === "empty" || state === "error") {
    return <DisputesList data={state === "error" ? null : state === "empty" ? { rows: [], total: 0, page: 1 } : list} base={BASE} />;
  }
  if (state === "offline") return <DisputeCase view={cancellationCase} offline base={BASE} submit={pretend(state)} />;
  if (state === "decided") return <DisputeCase view={decidedCase} base={BASE} submit={pretend(state)} />;
  const view = state === "problem" ? problemCase : cancellationCase;
  return (
    <DisputeCase
      key={state}
      view={decided ? (state === "problem" ? resolvedProblem : decidedCase) : view}
      base={BASE}
      submit={pretend(state)}
      onChanged={() => setDecided(true)}
      initialDialog={state === "partial-refund" || state === "refund-failed" ? "refund" : null}
      initialValues={state === "partial-refund" ? { mode: "partial", amount: "117.00", payTradie: true, hours: "0.5", note: "Half refunded: Jack had isolated the circuit." } : state === "refund-failed" ? { note: "Customer found someone else." } : undefined}
      initialError={state === "refund-failed" ? REFUSED : null}
    />
  );
}
