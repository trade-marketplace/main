import { describe, expect, it } from "vitest";
import { haversineKm } from "@/lib/geo/distance";
import { approximatePin } from "@/server/geo/approximate";
import { canClaim, canEstimate, eligibilityFailure, eligibilityPin, eligibleJobsFor, type EligibilityJob, type EligibilityWorker } from "@/server/workers/eligibility";
import { isVerified } from "@/server/workers/verification";

const NOW = new Date("2026-11-03T00:00:00Z");
const CHECKED = new Date("2026-10-01T00:00:00Z");
const CENTRE = { lat: -46.4132, lng: 168.3538 };
function worker(): EligibilityWorker {
  return { id: "worker", role: "TRADIE", email: "worker@example.test", emailVerifiedAt: CHECKED,
    workerProfile: { identityCheckedAt: CHECKED, identityCheckedById: "office", pausedAt: null, baseSuburb: "Invercargill", areaLat: CENTRE.lat, areaLng: CENTRE.lng, areaRadiusKm: 25, available: true },
    workerTrades: [{ trade: "ELECTRICAL", licence: { status: "VERIFIED", checkedAt: CHECKED, checkedById: "office", expiresOn: new Date("2027-01-01") } }] };
}
function job(overrides: Partial<EligibilityJob> = {}): EligibilityJob {
  const pin = approximatePin(CENTRE, () => 0.5);
  return { id: "job", customerId: "customer", workerId: null, status: "BOOKABLE", category: "ELECTRICAL", lat: CENTRE.lat, lng: CENTRE.lng, approxLat: pin.lat, approxLng: pin.lng, ...overrides };
}
const context = { now: NOW };

describe("shared worker eligibility", () => {
  it("allows current matching licensed work and Other without requiring an Other selection or phone proof", () => {
    const person = worker();
    expect(canClaim(person, job(), context)).toBe(true);
    person.workerTrades = [];
    expect(canClaim(person, job({ category: "OTHER" }), context)).toBe(true);
    expect(isVerified({ ...person, phone: null, phoneVerifiedAt: null, phoneVerifiedFor: null }, "OTHER", NOW)).toBe(false);
    person.workerProfile!.available = false; // Available controls pings, not browsing or manually taking work.
    expect(canClaim(person, job({ category: "OTHER" }), context)).toBe(true);
  });

  it("keeps discovery, estimating and claiming intents distinct", () => {
    const person = worker();
    for (const status of ["REVIEW", "QUOTE_BOUNTY", "BOOKABLE"] as const) {
      const candidate = job({ id: status, status });
      expect(eligibleJobsFor(person, [candidate], context)).toEqual([status]);
      expect(canClaim(person, candidate, context)).toBe(status === "BOOKABLE");
      expect(canEstimate(person, candidate, context)).toBe(status !== "BOOKABLE");
    }
    for (const status of ["PRICED", "ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW", "CANCELLED"] as const) {
      expect(eligibleJobsFor(person, [job({ status })], context)).toEqual([]);
    }
  });

  it("does not disclose or act on the worker's own jobs, even after switching account role", () => {
    const person = worker();
    for (const status of ["REVIEW", "QUOTE_BOUNTY", "BOOKABLE"] as const) {
      const own = job({ customerId: person.id, status });
      expect(canClaim(person, own, context)).toBe(false);
      expect(canEstimate(person, own, context)).toBe(false);
      expect(eligibleJobsFor(person, [own], context)).toEqual([]);
      expect(eligibilityFailure(person, own, "discover", context)).toBe("own-job");
    }
  });

  it.each<[string, (person: EligibilityWorker) => void, string]>([
    ["a customer", person => { person.role = "CUSTOMER"; }, "worker-required"],
    ["unconfirmed email", person => { person.emailVerifiedAt = null; }, "email-required"],
    ["future email confirmation", person => { person.emailVerifiedAt = new Date("2027-01-01"); }, "email-required"],
    ["missing office identity", person => { person.workerProfile!.identityCheckedAt = null; }, "identity-required"],
    ["missing identity checker", person => { person.workerProfile!.identityCheckedById = null; }, "identity-required"],
    ["office pause", person => { person.workerProfile!.pausedAt = CHECKED; }, "worker-paused"],
    ["no work area", person => { person.workerProfile!.areaLat = null; }, "work-area-required"],
    ["no suburb", person => { person.workerProfile!.baseSuburb = " "; }, "work-area-required"],
    ["invalid work point", person => { person.workerProfile!.areaLng = NaN; }, "work-area-required"],
    ["invalid radius", person => { person.workerProfile!.areaRadiusKm = 0; }, "work-area-required"],
    ["wrong trade", person => { person.workerTrades = []; }, "trade-mismatch"],
    ["no licence", person => { person.workerTrades[0].licence = null; }, "licence-required"],
    ["pending licence", person => { person.workerTrades[0].licence!.status = "PENDING"; }, "licence-required"],
    ["rejected licence", person => { person.workerTrades[0].licence!.status = "REJECTED"; }, "licence-required"],
    ["unchecked licence", person => { person.workerTrades[0].licence!.checkedById = null; }, "licence-required"],
    ["unknown licence expiry", person => { person.workerTrades[0].licence!.expiresOn = null; }, "licence-required"],
    ["expired licence", person => { person.workerTrades[0].licence!.expiresOn = new Date("2026-11-02"); }, "licence-required"],
  ])("refuses %s on every discovery/claim/estimate path", (_name, change, failure) => {
    const person = worker(); change(person);
    expect(eligibilityFailure(person, job(), "claim", context)).toBe(failure);
    expect(eligibleJobsFor(person, [job()], context)).toEqual([]);
    expect(canEstimate(person, job({ status: "REVIEW" }), context)).toBe(false);
  });

  it("honours office trade availability and refuses assignments that are no longer open", () => {
    expect(canClaim(worker(), job(), { ...context, enabledTrades: ["OTHER"] })).toBe(false);
    expect(canClaim(worker(), job({ workerId: "someone" }), context)).toBe(false);
    expect(canClaim(null, job(), context)).toBe(false);
  });

  it("uses the unrounded stable approximate point, including the radius edge", () => {
    const person = worker(), candidate = job(), pin = eligibilityPin(candidate)!;
    const exactDistance = haversineKm(CENTRE, pin);
    person.workerProfile!.areaRadiusKm = exactDistance;
    expect(canClaim(person, candidate, context)).toBe(true);
    person.workerProfile!.areaRadiusKm = exactDistance - 0.000001;
    expect(eligibilityFailure(person, candidate, "claim", context)).toBe("outside-work-area");
    // The exact address is at the worker's centre; using it would incorrectly permit this job.
    expect(eligibilityPin(candidate)).toEqual(eligibilityPin(candidate));
  });

  it.each([
    { approxLat: null, approxLng: null }, { approxLat: NaN }, { approxLng: 190 },
    { approxLat: CENTRE.lat, approxLng: CENTRE.lng }, { approxLat: CENTRE.lat + 0.00001, approxLng: CENTRE.lng },
    { approxLat: CENTRE.lat + 1, approxLng: CENTRE.lng }, { lat: null, lng: null },
  ])("fails closed for an invalid or unsafe persisted pin %o", change => {
    const candidate = job(change);
    expect(eligibilityPin(candidate)).toBeNull();
    expect(eligibleJobsFor(worker(), [candidate], context)).toEqual([]);
  });

  it("expires licences at the New Zealand calendar boundary and returns only IDs from discovery", () => {
    const person = worker(); person.workerTrades[0].licence!.expiresOn = new Date("2026-11-03");
    expect(canClaim(person, job(), { now: new Date("2026-11-03T10:59:59Z") })).toBe(true);
    expect(canClaim(person, job(), { now: new Date("2026-11-03T11:00:00Z") })).toBe(false);
    expect(eligibleJobsFor(person, [job({ id: "safe" }), job({ id: "owned", customerId: person.id })], context)).toEqual(["safe"]);
  });
});
