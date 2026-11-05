import "server-only";

import { approximatePin } from "@/server/geo/approximate";
import type { JobSource } from "@/server/views/jobs";

export const JOB_VIEW_PREVIEW_STATES = ["customer", "worker-unclaimed", "worker-assigned", "worker-reassigned", "worker-cancelled", "missing-pin", "office", "public", "loading", "error"] as const;
export type JobViewPreviewState = typeof JOB_VIEW_PREVIEW_STATES[number];

export const VIEWERS = {
  customer: { userId: "00000000-0000-4000-8000-000000000001", role: "CUSTOMER" },
  worker: { userId: "00000000-0000-4000-8000-000000000002", role: "TRADIE" },
  office: { userId: "00000000-0000-4000-8000-000000000003", role: "ADMIN" },
} as const;

/** Fictitious data only. The preview passes the same server projections used by production readers. */
export function exampleJob(overrides: Partial<JobSource> = {}): JobSource {
  const now = new Date("2026-11-03T00:00:00Z");
  const exact = { lat: -46.3985, lng: 168.3695 };
  const approx = approximatePin(exact, () => 0.5);
  return {
    id: "00000000-0000-4000-8000-000000001005", jobNumber: 1005, title: "Sub wiring", category: "ELECTRICAL",
    status: "ASSIGNED", customerId: VIEWERS.customer.userId, workerId: VIEWERS.worker.userId,
    description: "Replace the outdoor double plug.", suburb: "Windsor", city: "Invercargill",
    addressLine1: "1 Example Street", addressLine2: null, postcode: "9810", accessNotes: "Use the side gate.",
    lat: exact.lat, lng: exact.lng, approxLat: approx.lat, approxLng: approx.lng,
    locationSource: "SEARCH", coverage: "INSIDE", locationNeedsCheck: false,
    priceCents: 37200, asap: false, anyTime: false, bookedDate: new Date("2026-11-05"), bookedTime: "MORNING",
    createdAt: now, updatedAt: now, editedAt: null, photosNeedCheck: false,
    // Terminal examples were cancelled after an assigned/public price; draft examples override this fact.
    statusHistory: overrides.status === "CANCELLED" || overrides.status === "CANCEL_REVIEW" ? [{ fromStatus: "ASSIGNED", toStatus: overrides.status, createdAt: now }] : [],
    customer: { id: VIEWERS.customer.userId, firstName: "Sarah", lastName: "Thompson", phone: "0210000001", email: "sarah@example.test" },
    worker: { id: VIEWERS.worker.userId, firstName: "Jack", lastName: "Wilson", phone: "0210000002", email: "jack@example.test" },
    pricing: { workerRateCents: 7000, minMinutes: 120, holidayPayBps: 800, onCostBps: 2000, marginBps: 2000, gstBps: 1500,
      minutes: 150, materialsCents: 12000, workerGrossCents: 17500, holidayPayCents: 1400, onCostCents: 3500,
      marginCents: 4800, gstCents: 4852, note: "Office-only price note", pricedById: VIEWERS.office.userId, pricedAt: now, updatedAt: now },
    photos: [{ id: "00000000-0000-4000-8000-000000000010", position: 0 }],
    timeWindows: [{ date: new Date("2026-11-05"), timeOfDay: "MORNING" }],
    estimates: [
      { id: "estimate-1", workerId: VIEWERS.worker.userId, minutes: 150, materialsCents: 12000, note: "My estimate", needsSiteVisit: false, madeBeforeEdit: false, createdAt: now, updatedAt: now },
      { id: "estimate-2", workerId: "another-worker", minutes: 300, materialsCents: 15000, note: "Another worker's private estimate", needsSiteVisit: true, madeBeforeEdit: false, createdAt: now, updatedAt: now },
    ],
    ...overrides,
  };
}

/** Keep revocation distinct from a reopened/public job: its assignment belongs to somebody else. */
export function jobViewExample(state: JobViewPreviewState): JobSource {
  const job = exampleJob();
  if (state === "worker-reassigned") {
    const replacement = "00000000-0000-4000-8000-000000000004";
    return { ...job, status: "ASSIGNED", workerId: replacement, worker: { ...job.worker!, id: replacement } };
  }
  if (state === "worker-unclaimed" || state === "missing-pin") return { ...job, status: "BOOKABLE", workerId: null, worker: null,
    ...(state === "missing-pin" ? { approxLat: null, approxLng: null } : {}) };
  return state === "worker-cancelled" ? { ...job, status: "CANCELLED", statusHistory: [{ fromStatus: "ASSIGNED", toStatus: "CANCELLED", createdAt: job.updatedAt }] } : job;
}
