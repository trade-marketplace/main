import { describe, expect, it, vi } from "vitest";
import { approximatePin } from "@/server/geo/approximate";
import { canClaim, canEstimate, eligibilityFailure, type EligibilityJob } from "@/server/workers/eligibility";
import { licenceFact, loadTradieSetup, setupFacts, type SetupWorker } from "@/server/workers/setup";

vi.mock("next/cache", async importOriginal => ({ ...(await importOriginal<typeof import("next/cache")>()), unstable_noStore: vi.fn() }));

const NOW = new Date("2026-11-10T00:00:00Z");
const CHECKED = new Date("2026-10-01T00:00:00Z");
const CENTRE = { lat: -46.4132, lng: 168.3538 };
type Licence = NonNullable<SetupWorker["workerTrades"][number]["licence"]>;
const verified: Licence = { status: "VERIFIED", checkedAt: CHECKED, checkedById: "office", expiresOn: new Date("2027-06-01") };
const pending: Licence = { status: "PENDING", checkedAt: null, checkedById: null, expiresOn: new Date("2027-06-01") };
const trade = (name: SetupWorker["workerTrades"][number]["trade"], licence: Licence | null = null) => ({ trade: name, createdAt: CHECKED, licence });
function worker(overrides: Partial<SetupWorker> = {}): SetupWorker {
  return { id: "worker", role: "TRADIE", email: "worker@example.test", emailVerifiedAt: CHECKED, avatarPath: "avatars/worker/1.webp",
    workerProfile: { identityCheckedAt: CHECKED, identityCheckedById: "office", pausedAt: null, baseSuburb: "Invercargill", areaLat: CENTRE.lat, areaLng: CENTRE.lng, areaRadiusKm: 25, available: false },
    workerTrades: [trade("ELECTRICAL", verified)], ...overrides };
}
function job(category: EligibilityJob["category"], status: EligibilityJob["status"]): EligibilityJob {
  const pin = approximatePin(CENTRE, () => 0.5);
  return { id: "job", customerId: "customer", workerId: null, status, category, lat: CENTRE.lat, lng: CENTRE.lng, approxLat: pin.lat, approxLng: pin.lng, anyTime: true, timeWindows: [] };
}
const payroll = { bankAccountEncrypted: "b", irdNumberEncrypted: "i", bankAccountLast4: "0001", irdNumberLast3: "123", taxCode: "M", kiwiSaverRatePct: null };
const db = (profile: SetupWorker | null, details: typeof payroll | null = payroll) => ({ profile: { findUnique: vi.fn(async () => profile) }, payrollDetails: { findUnique: vi.fn(async () => details) } }) as unknown as Parameters<typeof loadTradieSetup>[0];

describe("setup steps come from saved facts", () => {
  it("marks every step done for a checked, fully set-up tradie", async () => {
    const result = await loadTradieSetup(db(worker()), "worker", NOW);
    expect(result).toMatchObject({ ok: true, setup: { done: 6, total: 6, complete: true, canBrowse: true } });
  });
  it("leaves each step open until its own fact is saved", () => {
    const empty = worker({ emailVerifiedAt: null, avatarPath: null, workerTrades: [], workerProfile: { ...worker().workerProfile!, areaLat: null, areaLng: null } });
    expect(setupFacts(empty, false, NOW)).toEqual({ emailVerified: false, tradeLabels: [], licence: "none", bankComplete: false, hasPhoto: false, hasWorkArea: false, canBrowse: false });
    expect(setupFacts(worker(), true, NOW)).toEqual({ emailVerified: true, tradeLabels: ["Electrical"], licence: "done", bankComplete: true, hasPhoto: true, hasWorkArea: true, canBrowse: true });
  });
  it("uses the payroll page's own complete rule for bank & IRD", async () => {
    for (const details of [null, { ...payroll, irdNumberEncrypted: null }, { ...payroll, taxCode: null }]) {
      const result = await loadTradieSetup(db(worker(), details as typeof payroll | null), "worker", NOW);
      expect(result.ok && result.setup.steps.find(step => step.id === "bank")?.state).toBe("todo");
    }
  });
  it("needs a current checked licence for every restricted trade before the licence step is done", () => {
    expect(licenceFact(worker(), NOW)).toBe("done");
    expect(licenceFact(worker({ workerTrades: [trade("ELECTRICAL", verified), trade("GAS", pending)] }), NOW)).toBe("checking");
    expect(licenceFact(worker({ workerTrades: [trade("ELECTRICAL", pending), trade("GAS", { ...pending, status: "REJECTED", checkedAt: CHECKED, checkedById: "office" })] }), NOW)).toBe("rejected");
    expect(licenceFact(worker({ workerTrades: [trade("PLUMBING", { ...verified, expiresOn: new Date("2026-11-01") })] }), NOW)).toBe("expired");
    // A "verified" row without the office's check behind it proves nothing: it is never shown as done.
    expect(licenceFact(worker({ workerTrades: [trade("ELECTRICAL", { ...verified, checkedById: null })] }), NOW)).toBe("checking");
  });
  it("what if they only do Other work? no licence step", async () => {
    const person = worker({ workerTrades: [trade("OTHER")] });
    expect(licenceFact(person, NOW)).toBe("none");
    const result = await loadTradieSetup(db(person), "worker", NOW);
    expect(result.ok && result.setup.steps.map(step => step.id)).toEqual(["email", "trades", "bank", "photo", "area"]);
    expect(result).toMatchObject({ ok: true, setup: { total: 5, complete: true } });
  });
  it("what if they're waiting on licence checks? they can browse and estimate, but not claim restricted work", async () => {
    const person = worker({ workerTrades: [trade("ELECTRICAL", pending)] });
    const result = await loadTradieSetup(db(person), "worker", NOW);
    expect(result).toMatchObject({ ok: true, setup: { complete: false, canBrowse: true, licenceChecking: true } });
    expect(result.ok && result.setup.steps.find(step => step.id === "licence")).toMatchObject({ state: "checking", action: null });
    // The shared eligibility rules (#137), unchanged: open work can be estimated and taken, restricted work can't be claimed.
    expect(canEstimate(person, job("OTHER", "REVIEW"), { now: NOW })).toBe(true);
    expect(canClaim(person, job("OTHER", "BOOKABLE"), { now: NOW })).toBe(true);
    expect(canClaim(person, job("ELECTRICAL", "BOOKABLE"), { now: NOW })).toBe(false);
    expect(eligibilityFailure(person, job("ELECTRICAL", "BOOKABLE"), "claim", { now: NOW })).toBe("licence-required");
  });
  it("only promises browsing when the board would really show jobs", () => {
    expect(setupFacts(worker({ workerProfile: { ...worker().workerProfile!, identityCheckedAt: null, identityCheckedById: null } }), true, NOW).canBrowse).toBe(false);
    expect(setupFacts(worker({ emailVerifiedAt: null }), true, NOW).canBrowse).toBe(false);
    expect(setupFacts(worker({ workerProfile: { ...worker().workerProfile!, pausedAt: CHECKED } }), true, NOW).canBrowse).toBe(false);
    expect(setupFacts(worker({ workerProfile: { ...worker().workerProfile!, baseSuburb: null } }), true, NOW)).toMatchObject({ canBrowse: false, hasWorkArea: false });
  });
  it("never reports a finished setup for someone else, a customer or an outage", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadTradieSetup(db(null), "worker", NOW)).toEqual({ ok: false });
    expect(await loadTradieSetup(db(worker({ role: "CUSTOMER" })), "worker", NOW)).toEqual({ ok: false });
    const broken = { profile: { findUnique: async () => { throw new Error("down"); } }, payrollDetails: { findUnique: async () => null } } as unknown as Parameters<typeof loadTradieSetup>[0];
    expect(await loadTradieSetup(broken, "worker", NOW)).toEqual({ ok: false });
    quiet.mockRestore();
  });
});
