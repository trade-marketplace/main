import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProfileCard } from "@/components/cards/ProfileCard";
import { WorkerCard } from "@/components/cards/WorkerCard";
import { VerifiedBadge } from "@/components/status/VerifiedBadge";
import { PREVIEW_NOW, verificationExample } from "@/app/dev/components/verified-badge/preview-data";
import { isVerified, verifiedBadgeFor, type WorkerVerification } from "@/server/workers/verification";

vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }));

const fixture = () => verificationExample("verified").worker;
describe("current worker verification proofs", () => {
  it("accepts a current checked restricted trade and Other with the same identity/contact proofs", () => {
    expect(isVerified(fixture(), "ELECTRICAL", PREVIEW_NOW)).toBe(true);
    expect(isVerified(verificationExample("other").worker, "OTHER", PREVIEW_NOW)).toBe(true);
  });

  it.each(["email-unconfirmed", "phone-unconfirmed", "phone-changed", "id-unchecked", "checking", "rejected", "expired", "unchecked-trade", "paused"])("hides the badge for %s", state => {
    const { worker, trade } = verificationExample(state);
    expect(isVerified(worker, trade, PREVIEW_NOW)).toBe(false);
  });

  it.each<[string, (worker: WorkerVerification) => void]>([
    ["a missing office identity checker", worker => { worker.workerProfile!.identityCheckedById = null; }],
    ["a missing licence checker", worker => { worker.workerTrades[0].licence!.checkedById = null; }],
    ["a missing licence check time", worker => { worker.workerTrades[0].licence!.checkedAt = null; }],
    ["unknown licence expiry", worker => { worker.workerTrades[0].licence!.expiresOn = null; }],
    ["a missing licence", worker => { worker.workerTrades[0].licence = null; }],
    ["an empty email", worker => { worker.email = " "; }],
    ["an invalid phone", worker => { worker.phone = worker.phoneVerifiedFor = "021"; }],
    ["a local phone rather than stored canonical E164", worker => { worker.phone = worker.phoneVerifiedFor = "0210000002"; }],
    ["no worker profile", worker => { worker.workerProfile = null; }],
    ["no advertised trades", worker => { worker.workerTrades = []; }],
    ["a customer", worker => { worker.role = "CUSTOMER"; }],
    ["an invalid proof timestamp", worker => { worker.phoneVerifiedAt = new Date(NaN); }],
    ["a future email confirmation", worker => { worker.emailVerifiedAt = new Date("2027-01-01"); }],
    ["a future phone confirmation", worker => { worker.phoneVerifiedAt = new Date("2027-01-01"); }],
    ["a future ID check", worker => { worker.workerProfile!.identityCheckedAt = new Date("2027-01-01"); }],
    ["a future licence check", worker => { worker.workerTrades[0].licence!.checkedAt = new Date("2027-01-01"); }],
  ])("fails closed for %s", (_name, change) => {
    const worker = fixture(); change(worker);
    expect(isVerified(worker, "ELECTRICAL", PREVIEW_NOW)).toBe(false);
  });

  it("does not lend a checked Electrical licence to unchecked Plumbing or a generic profile badge", () => {
    const worker = fixture();
    worker.workerTrades.push({ trade: "PLUMBING", licence: null }, { trade: "OTHER", licence: null });
    expect(isVerified(worker, "ELECTRICAL", PREVIEW_NOW)).toBe(true);
    expect(isVerified(worker, "OTHER", PREVIEW_NOW)).toBe(true);
    expect(isVerified(worker, "PLUMBING", PREVIEW_NOW)).toBe(false);
    expect(isVerified(worker, undefined, PREVIEW_NOW)).toBe(false);
  });

  it("expires a date-only licence at midnight in New Zealand, including the daylight-saving offset", () => {
    const worker = fixture();
    worker.workerTrades[0].licence!.expiresOn = new Date("2026-11-03T00:00:00Z");
    expect(isVerified(worker, "ELECTRICAL", new Date("2026-11-03T10:59:59Z"))).toBe(true);
    expect(isVerified(worker, "ELECTRICAL", new Date("2026-11-03T11:00:00Z"))).toBe(false);
  });

  it("hides missing workers, malformed dates and invalid evaluation times", () => {
    expect(isVerified(null)).toBe(false);
    expect(isVerified(undefined)).toBe(false);
    expect(isVerified(fixture(), "ELECTRICAL", new Date(NaN))).toBe(false);
    const malformed = fixture();
    malformed.phoneVerifiedAt = "confirmed" as unknown as Date;
    expect(isVerified(malformed, "ELECTRICAL", PREVIEW_NOW)).toBe(false);
  });

  it("reads fresh proofs each time and hides the badge on a data outage without logging private evidence", async () => {
    const findUnique = vi.fn().mockResolvedValueOnce(fixture()).mockResolvedValueOnce(verificationExample("paused").worker).mockRejectedValueOnce(new Error("private phone +64210000002"));
    const db = { profile: { findUnique } } as unknown as Parameters<typeof verifiedBadgeFor>[0];
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await verifiedBadgeFor(db, "worker", "ELECTRICAL", PREVIEW_NOW)).toBe(true);
      expect(await verifiedBadgeFor(db, "worker", "ELECTRICAL", PREVIEW_NOW)).toBe(false);
      expect(await verifiedBadgeFor(db, "worker", "ELECTRICAL", PREVIEW_NOW)).toBe(false);
      expect(findUnique).toHaveBeenCalledTimes(3);
      expect(log).toHaveBeenCalledExactlyOnceWith("Worker verification unavailable.");
    } finally { log.mockRestore(); }
  });
});

describe("public verification presentation", () => {
  it("never renders a seal for a failed decision and describes Other without a licence claim", () => {
    expect(renderToStaticMarkup(<VerifiedBadge verified={false} trade="ELECTRICAL" />)).toBe("");
    const other = renderToStaticMarkup(<VerifiedBadge verified trade="OTHER" />);
    expect(other).toContain("Verified");
    expect(other).not.toContain("Licence checked");
    expect(renderToStaticMarkup(<VerifiedBadge verified trade="ELECTRICAL" />)).toContain("Licence checked");
  });
  it("uses the same computed badge on tiles, profiles and booked summaries without exposing private proofs", () => {
    const verification = { verified: true, trade: "ELECTRICAL" as const };
    for (const card of [<WorkerCard key="tile" name="Jack W." verification={verification} href="/example" />, <ProfileCard key="profile" name="Jack W." verification={verification} />, <WorkerCard key="booked" name="Jack W." verification={verification} />]) {
      const html = renderToStaticMarkup(card);
      expect(html).toContain("Licence checked");
      expect(html).not.toMatch(/phoneVerified|identityChecked|worker@example|\+6421/);
    }
  });
});
