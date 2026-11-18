import { describe, expect, it } from "vitest";
import { emailOwnershipProved } from "@/server/auth/email-ownership";

describe("emailOwnershipProved (#353)", () => {
  const now = new Date("2026-11-16T00:00:00Z");
  it("needs a real proof time at or before now", () => {
    expect(emailOwnershipProved({ email: "sam@example.test", emailVerifiedAt: new Date("2026-11-01T00:00:00Z") }, now)).toBe(true);
    expect(emailOwnershipProved({ email: "sam@example.test", emailVerifiedAt: now }, now)).toBe(true);
    expect(emailOwnershipProved({ email: "sam@example.test", emailVerifiedAt: null }, now)).toBe(false);
    expect(emailOwnershipProved({ email: "sam@example.test", emailVerifiedAt: new Date("2026-11-17T00:00:00Z") }, now)).toBe(false);
    expect(emailOwnershipProved({ email: "sam@example.test", emailVerifiedAt: new Date(Number.NaN) }, now)).toBe(false);
  });
  it("refuses a missing profile or a profile without an email", () => {
    expect(emailOwnershipProved(null, now)).toBe(false);
    expect(emailOwnershipProved(undefined, now)).toBe(false);
    expect(emailOwnershipProved({ email: " ", emailVerifiedAt: new Date("2026-11-01T00:00:00Z") }, now)).toBe(false);
    expect(emailOwnershipProved({ email: null, emailVerifiedAt: new Date("2026-11-01T00:00:00Z") }, now)).toBe(false);
  });
});
