import { describe, expect, it } from "vitest";
import { moderationReason, parseReviewsQuery, reviewsHref, reviewCustomerName } from "@/lib/office/reviews";
describe("office review query and moderation", () => {
  it("keeps tab, search and paging in an encoded URL", () => { const q = parseReviewsQuery({ tab: "hidden", q: "  Sarah & Jack  ", page: "2" }); expect(q).toEqual({ tab: "hidden", q: "Sarah & Jack", page: 2 }); expect(reviewsHref(q)).toBe("/admin/reviews?tab=hidden&q=Sarah+%26+Jack&page=2"); });
  it("uses a data-dependent default and bounds malformed input", () => { expect(parseReviewsQuery({ tab: "unknown", page: "Infinity", q: "x".repeat(100) })).toMatchObject({ tab: null, page: 1, q: "x".repeat(80) }); });
  it("requires a trimmed reason from 3 to 500 characters", () => { expect(moderationReason("  a ")).toBeNull(); expect(moderationReason(" abc ")).toBe("abc"); expect(moderationReason("x".repeat(500))).toHaveLength(500); expect(moderationReason("x".repeat(501))).toBeNull(); });
  it("returns first name and last initial only", () => { expect(reviewCustomerName({ firstName: "Sarah", lastName: "Taylor" })).toBe("Sarah T."); expect(reviewCustomerName({ firstName: "Sarah", lastName: null })).toBe("Sarah"); });
});
