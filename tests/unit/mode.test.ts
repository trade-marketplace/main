import { describe, expect, it } from "vitest";

import { DEFAULT_MODE, isMode, MODES, modeForRole, ROLES, type Role } from "@/lib/mode";

describe("modeForRole", () => {
  it("maps each role to its palette", () => {
    expect(modeForRole("CUSTOMER")).toBe("customer");
    expect(modeForRole("TRADIE")).toBe("trade");
    expect(modeForRole("ADMIN")).toBe("office");
  });

  it("gives signed-out visitors the customer palette", () => {
    expect(modeForRole(null)).toBe("customer");
    expect(modeForRole(undefined)).toBe("customer");
    expect(DEFAULT_MODE).toBe("customer");
  });

  it("falls back to customer for a role it doesn't know (e.g. bad data at runtime)", () => {
    expect(modeForRole("SUPERUSER" as Role)).toBe("customer");
  });

  it("gives every role a real mode", () => {
    for (const role of ROLES) expect(MODES).toContain(modeForRole(role));
  });
});

describe("isMode", () => {
  it("accepts only the three modes", () => {
    expect(MODES.every(isMode)).toBe(true);
    expect(isMode("Trade")).toBe(false);
    expect(isMode("")).toBe(false);
    expect(isMode(undefined)).toBe(false);
    expect(isMode(["trade"])).toBe(false);
  });
});
