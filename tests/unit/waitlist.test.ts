import { describe, expect, it, vi } from "vitest";

import { INVERCARGILL_COVERAGE } from "@/lib/geo/coverage";
import { jobStartPath } from "@/lib/landing";
import { suburbKey, waitlistInput, waitlistLocation, waitlistSharePath } from "@/lib/waitlist";
import { saveWaitlist, type WaitlistStore } from "@/server/waitlist";

const input = { email: "  Sarah@Example.test ", suburb: " Wellington " };
function store(create = vi.fn().mockResolvedValue({})) {
  return { create, db: { waitlistEntry: { create } } as unknown as WaitlistStore };
}

describe("waitlist handoff", () => {
  it("consumes the existing jobStartPath location without changing its private job draft", () => {
    const url = new URL(jobStartPath({ description: "Fix my gate", category: "other", location: { label: "Wellington", point: { lat: -41.2866, lng: 174.7756 } } }, INVERCARGILL_COVERAGE), "https://example.test");
    expect(url.pathname).toBe("/coming-soon");
    expect(waitlistLocation(Object.fromEntries(url.searchParams))).toBe("Wellington");
    expect(url.searchParams.get("description")).toBe("Fix my gate");
  });
  it("refuses repeated, oversized, missing and control-character location parameters", () => {
    for (const location of [undefined, ["A", "B"], "a".repeat(81), "A\u0000B", "\t"]) expect(waitlistLocation({ location })).toBe("");
    expect(waitlistLocation({ location: " Ōtaki " })).toBe("Ōtaki");
  });
  it("encodes share locations and includes no email, coordinates or job description", () => {
    expect(waitlistSharePath("A & B")).toBe("/coming-soon?location=A+%26+B");
    expect(waitlistSharePath("")).toBe("/coming-soon");
    expect(waitlistSharePath("\u0000")).toBe("/coming-soon");
  });
});

describe("saving the waitlist", () => {
  it("persists normalized email, the entered suburb and its duplicate key", async () => {
    const { create, db } = store();
    await expect(saveWaitlist(input, () => db)).resolves.toEqual({ status: "joined" });
    expect(create).toHaveBeenCalledExactlyOnceWith({ data: { email: "sarah@example.test", suburb: "Wellington", suburbKey: "wellington" } });
    expect(suburbKey("  LOWER   Hutt ")).toBe("lower hutt");
  });
  it("returns already-on-list for the atomic unique conflict, including a racing signup", async () => {
    const { db } = store(vi.fn().mockRejectedValue({ code: "P2002" }));
    await expect(saveWaitlist(input, () => db)).resolves.toEqual({ status: "already-on-list" });
  });
  it("never claims success when the database is absent or unavailable", async () => {
    await expect(saveWaitlist(input, () => null)).resolves.toEqual({ status: "error" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = store(vi.fn().mockRejectedValue(new Error("private email")));
    await expect(saveWaitlist(input, () => db)).resolves.toEqual({ status: "error" });
    expect(log).toHaveBeenCalledWith("Waitlist could not be saved.");
    log.mockRestore();
  });
  it("validates both fields on the server before opening the database", async () => {
    for (const bad of [{ ...input, email: "wrong" }, { ...input, suburb: " " }, { ...input, suburb: "a".repeat(81) }, { ...input, suburb: "A\u0000B" }, { ...input, email: new Blob() }]) {
      const database = vi.fn();
      expect((await saveWaitlist(bad, database)).status).toBe("error");
      expect(database).not.toHaveBeenCalled();
    }
    expect(waitlistInput.safeParse(input).success).toBe(true);
  });
});
