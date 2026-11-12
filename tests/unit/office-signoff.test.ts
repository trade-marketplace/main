import { describe, expect, it } from "vitest";
import { flagNote, signoffClock } from "@/lib/office/signoff";
describe("office sign-off view rules", () => {
  it("uses configured hours and pauses for a problem", () => { const now = Date.UTC(2026, 10, 12, 3); expect(signoffClock("2026-11-12T01:00:00Z", 72, false, now)).toBe("Sent 2h ago · completes by itself in 70h"); expect(signoffClock("2026-11-12T01:00:00Z", 72, true, now)).toBe("Paused: problem reported"); expect(signoffClock(null, 48, false, now)).toBe("Not sent"); });
  it("requires a trimmed note of 3 to 500 characters", () => { expect(flagNote(" hi ")).toBeNull(); expect(flagNote(" abc ")).toBe("abc"); expect(flagNote("a".repeat(500))).toHaveLength(500); expect(flagNote("a".repeat(501))).toBeNull(); });
});
