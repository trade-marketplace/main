import { describe, expect, it, vi } from "vitest";

import { CATEGORIES } from "@/lib/cards";
import { INVERCARGILL_COVERAGE as coverage } from "@/lib/geo/coverage";
import { jobStartPath } from "@/lib/landing";
import { serviceDescription, serviceWaitlistInput } from "@/lib/services";
import { loadService, saveServiceWaitlist, SERVICE_CONTENT, type ServiceWaitlistStore } from "@/server/services";

vi.mock("@/server/geo/coverage-settings", () => ({ loadCoverage: async () => coverage }));

describe("service content and handoffs", () => {
  it.each(CATEGORIES)("uses the launch trade config and preserves %s on every popular-job handoff", (category) => {
    const content = SERVICE_CONTENT[category];
    expect(content.live).toBe(true);
    expect(content.jobs.length).toBeGreaterThan(0);
    for (const job of content.jobs) {
      const url = new URL(jobStartPath({ category, description: serviceDescription(job, "My own & unusual job"), location: { label: coverage.name, point: coverage.centre } }, coverage), "https://example.test");
      expect(url.searchParams.get("type")).toBe(category);
      expect(url.searchParams.get("description")).toBe(job.custom ? "My own & unusual job" : job.name);
      expect(url.searchParams.get("location")).toBe(coverage.name);
    }
  });
  it("Other explicitly covers the requested kinds of labour without changing the job type", () => {
    expect(SERVICE_CONTENT.other.headline).toBe("Anything else");
    expect(SERVICE_CONTENT.other.intro).toMatch(/Moving, cleaning, gardening, assembly/);
  });
  it("never presents mockup rates, review counts, insurance or blanket certificate promises", () => {
    expect(JSON.stringify(SERVICE_CONTENT)).not.toMatch(/\$|insured|insurance|CoC every time|reviews/);
  });
  it("loads no invented reviews when the database is absent", async () => {
    expect(await loadService("electrical", null)).toMatchObject({ category: "electrical", coverage, reviews: [] });
  });
  it("reads only visible reviews for the requested trade and public first names", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "real", rating: 4, comment: "Customer words", reviewer: { firstName: "First" } }, { id: "blank", rating: 5, comment: " ", reviewer: { firstName: "Hidden" } }]);
    const data = await loadService("other", { review: { findMany } } as unknown as Parameters<typeof loadService>[1]);
    expect(data.reviews).toEqual([{ id: "real", rating: 4, comment: "Customer words", name: "First" }]);
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { hiddenAt: null, job: { trade: "OTHER" } }, select: { reviewer: { select: { firstName: true } } } });
    expect(findMany.mock.calls[0][0].select).not.toHaveProperty("job");
  });
  it("reports a review failure without exposing raw database details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const data = await loadService("plumbing", { review: { findMany: vi.fn().mockRejectedValue(new Error("private details")) } } as unknown as Parameters<typeof loadService>[1]);
    expect(data.reviewsUnavailable).toBe(true);
    expect(data.reviews).toEqual([]);
    expect(log).toHaveBeenCalledWith("Service reviews unavailable."); log.mockRestore();
  });
});

describe("service waitlist", () => {
  const input = { email: " FIRST@Example.test ", suburb: " Lower Hutt ", trade: "other" };
  function store(create = vi.fn().mockResolvedValue({})) { return { create, db: { serviceWaitlistEntry: { create } } as unknown as ServiceWaitlistStore }; }
  it("saves the trade with normalized email and suburb, independently of the area waitlist", async () => {
    const { create, db } = store();
    expect(await saveServiceWaitlist(input, () => db)).toEqual({ status: "joined" });
    expect(create).toHaveBeenCalledExactlyOnceWith({ data: { email: "first@example.test", suburb: "Lower Hutt", suburbKey: "lower hutt", trade: "OTHER" } });
  });
  it("only says already on list after an atomic duplicate conflict", async () => {
    expect(await saveServiceWaitlist(input, () => store(vi.fn().mockRejectedValue({ code: "P2002" })).db)).toEqual({ status: "already-on-list" });
  });
  it("never claims success without a database or after a save failure", async () => {
    expect(await saveServiceWaitlist(input, () => null)).toEqual({ status: "error" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await saveServiceWaitlist(input, () => store(vi.fn().mockRejectedValue(new Error("private"))).db)).toEqual({ status: "error" });
    expect(log).toHaveBeenCalledWith("Service waitlist could not be saved."); log.mockRestore();
  });
  it("validates hostile, missing and repeated trade and field inputs before opening the database", async () => {
    for (const bad of [{ ...input, trade: "garden" }, { ...input, trade: ["other", "gas"] }, { ...input, trade: null }, { ...input, email: "bad" }, { ...input, suburb: "" }, { ...input, suburb: "a".repeat(81) }, { ...input, suburb: "A\u0000B" }]) {
      const database = vi.fn(); expect(serviceWaitlistInput.safeParse(bad).success).toBe(false);
      expect((await saveServiceWaitlist(bad, database)).status).toBe("error"); expect(database).not.toHaveBeenCalled();
    }
  });
});
