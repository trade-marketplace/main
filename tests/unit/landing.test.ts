import { describe, expect, it, vi } from "vitest";

import { decideRoute, safeNextPath } from "@/lib/auth/routes";
import { INVERCARGILL_COVERAGE as coverage } from "@/lib/geo/coverage";
import { ipLocation, jobStartPath } from "@/lib/landing";
import { landingReviews } from "@/server/landing";

describe("homepage hand-offs", () => {
  it("preserves free text, category and location safely in a local job-start URL", () => {
    const description = "Fix a tap & fence? #1 <script> · 庭";
    const path = jobStartPath({ description, category: "other", location: { label: "Invercargill", point: coverage.centre } }, coverage);
    const url = new URL(path, "https://example.test");
    expect(url.origin).toBe("https://example.test"); expect(url.pathname).toBe("/jobs/new");
    expect(url.searchParams.get("description")).toBe(description);
    expect(url.searchParams.get("type")).toBe("other");
    expect(url.searchParams.get("lat")).toBe(String(coverage.centre.lat));
  });
  it("passes outside-area details to the waitlist without losing the draft", () => {
    const url = new URL(jobStartPath({ description: "Move a couch", category: "other", location: { label: "Wellington", point: { lat: -41.2866, lng: 174.7756 } } }, coverage), "https://example.test");
    expect(url.pathname).toBe("/coming-soon"); expect(url.searchParams.get("description")).toBe("Move a couch"); expect(url.searchParams.get("location")).toBe("Wellington");
  });
  it("allows an empty or manually entered start, bounds input and rejects an invented category", () => {
    const url = new URL(jobStartPath({ description: "x".repeat(3000), category: "invented" as "other", location: { label: "Manual town", point: null } }, coverage), "https://example.test");
    expect(url.pathname).toBe("/jobs/new"); expect(url.searchParams.get("description")).toHaveLength(120); expect(url.searchParams.has("type")).toBe(false); expect(url.searchParams.has("lat")).toBe(false);
    expect(jobStartPath({ description: "", location: { label: "", point: null } }, coverage)).toBe("/jobs/new");
  });
  it("keeps signed-in customers on the homepage while other roles retain their own home", () => {
    expect(decideRoute("/", { role: "CUSTOMER" })).toEqual({ action: "allow" });
    expect(decideRoute("/", { role: "TRADIE" })).toEqual({ action: "redirect", to: "/jobs" });
    expect(decideRoute("/", { role: "ADMIN" })).toEqual({ action: "redirect", to: "/admin" });
  });
  it("keeps the longest Unicode hand-off inside the authentication return-path limit", () => {
    const path = jobStartPath({ description: "庭".repeat(120), location: { label: "街".repeat(80), point: coverage.centre } }, coverage);
    expect(safeNextPath(path)).toBe(path);
  });
});

describe("editable IP location hints", () => {
  it("uses a valid city/point and ignores malformed or incomplete headers", () => {
    const headers = new Headers({ "x-vercel-ip-city": "Wellington%20City", "x-vercel-ip-latitude": "-41.2866", "x-vercel-ip-longitude": "174.7756" });
    expect(ipLocation(headers, coverage)).toEqual({ label: "Wellington City", point: { lat: -41.2866, lng: 174.7756 } });
    for (const value of ["NaN", "91", "", "Infinity"]) { headers.set("x-vercel-ip-latitude", value); expect(ipLocation(headers, coverage)).toEqual({ label: "Invercargill", point: null }); }
    expect(ipLocation(new Headers(), coverage)).toEqual({ label: "Invercargill", point: null });
  });
});

describe("real public reviews", () => {
  it("hides the section with no database or when the query fails", async () => {
    expect(await landingReviews(null)).toEqual([]);
    const log = vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const db = { review: { findMany: vi.fn().mockRejectedValue(new Error("private DB details")) } };
    expect(await landingReviews(db as unknown as Parameters<typeof landingReviews>[0])).toEqual([]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");log.mockRestore();
  });
  it("selects visible reviews and only public text, rating and first name", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "real-review", rating: 4, comment: "Actual customer words", reviewer: { firstName: "Customer" } }]);
    expect(await landingReviews({ review: { findMany } } as unknown as Parameters<typeof landingReviews>[0])).toEqual([{ id: "real-review", rating: 4, comment: "Actual customer words", name: "Customer" }]);
    const query = findMany.mock.calls[0][0];
    expect(query.where.hiddenAt).toBeNull(); expect(query.select).not.toHaveProperty("job"); expect(query.select.reviewer.select).toEqual({ firstName: true });
  });
});
