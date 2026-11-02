// Pretend job data for /dev/components/office-job. Names, prices and times are examples; they follow the
// mockup (pages.html w-o-job: TM-1005, Sub wiring, Sarah Thompson to Jack Wilson).
import type { OfficeJobView, TimelineEntry } from "@/lib/office-job";

export const PREVIEW_STATES = ["default", "unpaid", "no-tradie", "cancelled", "long-text", "loading", "error"] as const;
export type PreviewState = (typeof PREVIEW_STATES)[number];

export function isPreviewState(value: string | undefined): value is PreviewState {
  return PREVIEW_STATES.some((state) => state === value);
}

const JOB_ID = "00000000-0000-4000-8000-000000001005";

const entry = (id: string, actor: TimelineEntry["actor"], actorName: string | null, title: string, when: string, detail: string | null = null): TimelineEntry => ({
  id,
  actor,
  actorName,
  title,
  detail,
  when,
  at: "2026-11-02T00:40:00.000Z",
});

const TIMELINE: TimelineEntry[] = [
  entry("t1", "customer", "Sarah", "Extra work approved + paid", "11:40 today"),
  entry("t2", "office", "Matt", "Extra work priced $148.00", "10:58 today"),
  entry("t3", "tradie", "Jack", "Extra work requested", "10:31 today"),
  entry("t4", "tradie", "Jack", "Claimed by Jack Wilson", "Tue 9:02"),
  entry("t5", "customer", "Sarah", "Paid $372.00", "Tue 8:40"),
  entry("t6", "office", "Matt", "Priced $372.00", "Mon 16:20", "Trimmed average of 3, plus 30 min for access."),
  entry("t7", "system", null, "5 estimates", "Mon 15:05"),
  entry("t8", "customer", "Sarah", "Posted", "Mon 9:12"),
];

export function previewJob(state: PreviewState): OfficeJobView {
  const base: OfficeJobView = {
    id: JOB_ID,
    number: "TM-1005",
    title: "Sub wiring",
    status: "ASSIGNED",
    trade: "Electrical",
    suburb: "Windsor",
    customer: { id: "c1", name: "Sarah Thompson" },
    tradie: { id: "w1", name: "Jack Wilson" },
    priceCents: 37200,
    pricing: { minutes: 150, materialsCents: 12000 },
    money: {
      paidCents: 37200,
      extraWorkCents: 14800,
      refundedCents: 0,
      tradieEarnsCents: 25920,
      payroll: { label: "After sign-off", kind: "waiting" },
    },
    payments: [
      { id: "p1", label: "Job", amountCents: 37200, refundableCents: 37200 },
      { id: "p2", label: "Extra work", amountCents: 14800, refundableCents: 14800 },
    ],
    messages: [
      { id: "m1", from: "Sarah Thompson", fromOffice: false, body: "Kia ora Sarah, Thursday 8am suit?", at: "2026-11-02T00:00:00.000Z", when: "Mon 17:30" },
      { id: "m2", from: "Office", fromOffice: true, body: "Perfect, see you then.", at: "2026-11-02T00:01:00.000Z", when: "Mon 17:41" },
    ],
    timeline: TIMELINE,
    reassignOptions: [
      { id: "w2", name: "Aroha Ngata" },
      { id: "w3", name: "Tom Fraser" },
      { id: "w4", name: "Priya Patel" },
    ],
  };

  switch (state) {
    case "unpaid":
      return {
        ...base,
        status: "REVIEW",
        tradie: null,
        priceCents: null,
        pricing: null,
        money: { paidCents: 0, extraWorkCents: 0, refundedCents: 0, tradieEarnsCents: null, payroll: { label: "After sign-off", kind: "waiting" } },
        payments: [],
        messages: [],
        reassignOptions: [],
        timeline: [entry("u1", "system", null, "5 estimates", "Mon 15:05"), entry("u2", "customer", "Sarah", "Posted", "Mon 9:12")],
      };
    case "no-tradie":
      return {
        ...base,
        status: "BOOKABLE",
        tradie: null,
        money: { ...base.money, extraWorkCents: 0, tradieEarnsCents: 25920 },
        payments: [{ id: "p1", label: "Job", amountCents: 37200, refundableCents: 37200 }],
        reassignOptions: [],
        timeline: TIMELINE.filter((row) => !["t1", "t2", "t3", "t4"].includes(row.id)),
      };
    case "cancelled":
      return {
        ...base,
        status: "CANCELLED",
        money: {
          ...base.money,
          extraWorkCents: 0,
          refundedCents: 37200,
          payroll: { label: "No payout", kind: "waiting" },
        },
        payments: [],
        reassignOptions: [],
        timeline: [
          entry("x1", "office", "Matt", "Refunded $372.00", "11:52 today", "Customer asked to cancel before the work started."),
          entry("x2", "office", "Matt", "Cancelled by the office", "11:50 today", "Customer asked to cancel before the work started."),
          ...TIMELINE.filter((row) => ["t4", "t5", "t6", "t7", "t8"].includes(row.id)),
        ],
      };
    case "long-text":
      // The long-text case: a very long title, long names and a long note must wrap, never push the page sideways.
      return {
        ...base,
        title: "Rewire the whole of the upstairs of the villa including the sleepouts, garage and the long driveway lights",
        customer: { id: "c1", name: "Alexandria-Anahera Te Aho-Williams-Montgomery" },
        tradie: { id: "w1", name: "Bartholomew Featherstonehaugh-Cholmondeley" },
        messages: [],
        timeline: [
          entry("q1", "office", "Matt", "Reassigned to Bartholomew Featherstonehaugh-Cholmondeley", "11:40 today", "Alexandria-Anahera asked for someone closer, and Jack was running two jobs on the same day, so Matt moved this one across after checking the new tradie’s licence."),
          ...TIMELINE.slice(3),
        ],
      };
    default:
      return base;
  }
}
