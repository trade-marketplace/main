import { describe, expect, it } from "vitest";
import { parseTradieSelection, tradieDecisionSchema, tradiesHref, tradiesQuery } from "@/lib/office-tradies";
const userId = "17400000-0000-4000-8000-000000000001";
describe("office tradie input", () => {
  it("preserves only bounded table/detail navigation", () => {
    const query = tradiesQuery({ tab: "verified", q: " Jack Wilson ", sort: "expiry", page: "2", selected: `${userId}:GAS`, returnTo: "https://evil.test" });
    expect(query).toMatchObject({ q: "Jack Wilson", page: 2, tab: "verified" });
    expect(new URL(tradiesHref(query), "https://local.test").searchParams.get("selected")).toBe(`${userId}:GAS`);
    expect(tradiesHref(query)).not.toContain("evil");
    expect(tradiesQuery({ page: "-1", tab: ["paused"], q: ["x"], selected: `${userId}:OTHER:extra` })).toEqual({ tab: "check", q: "", page: 1, selected: null, sort: "joined" });
    expect(parseTradieSelection(`${userId}:UNKNOWN`)).toBeNull();
  });
  it("requires a decision note, a public rejection reason, and an explicit pause version", () => {
    const licence = { userId, trade: "GAS", version: "a".repeat(64), note: "Checked the PGDB register" };
    expect(tradieDecisionSchema.safeParse({ ...licence, kind: "approve" }).success).toBe(true);
    for (const raw of [{ ...licence, kind: "approve", note: " " }, { ...licence, kind: "reject" }, { ...licence, kind: "approve", status: "VERIFIED" }, { ...licence, kind: "approve", trade: "OTHER" }, { kind: "pause", userId, note: "Review" }]) expect(tradieDecisionSchema.safeParse(raw).success).toBe(false);
    expect(tradieDecisionSchema.safeParse({ ...licence, kind: "reject", reason: "Please upload the current card" }).success).toBe(true);
    expect(tradieDecisionSchema.safeParse({ kind: "unpause", userId, expectedPausedAt: "2026-11-05T00:00:00Z", note: "Issue checked" }).success).toBe(true);
  });
});
