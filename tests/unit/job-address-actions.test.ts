import { beforeEach, describe, expect, it, vi } from "vitest";
import { INVERCARGILL_COVERAGE } from "@/lib/geo/coverage";
import { consumeForClient } from "@/server/rate-limit";
import { loadCoverage } from "@/server/geo/coverage-settings";
import { searchJobAddresses } from "@/server/jobs/address-search";
import { checkJobDraftLocationAction, searchJobAddressesAction } from "@/server/jobs/address-actions";
vi.mock("@/server/rate-limit", () => ({ consumeForClient: vi.fn() }));
vi.mock("@/server/geo/coverage-settings", () => ({ loadCoverage: vi.fn() }));
beforeEach(() => { vi.mocked(consumeForClient).mockResolvedValue({ allowed: true }); vi.mocked(loadCoverage).mockResolvedValue(INVERCARGILL_COVERAGE); });
describe("public guest address contract", () => {
  it("uses a manual fallback without a provider, and bounds queries before provider access", async () => {
    expect(await searchJobAddresses("12 Dee", { provider: null, coverage: INVERCARGILL_COVERAGE })).toEqual({ mode: "manual", reason: "not-configured" });
    const suggest = vi.fn<(query: string) => Promise<[]>>().mockResolvedValue([]);
    expect(await searchJobAddresses("12", { provider: { suggest }, coverage: INVERCARGILL_COVERAGE })).toEqual({ mode: "search", suggestions: [] }); expect(suggest).not.toHaveBeenCalled();
    await searchJobAddresses("x".repeat(999), { provider: { suggest }, coverage: INVERCARGILL_COVERAGE }); expect(suggest.mock.calls[0][0]).toHaveLength(200);
  });
  it("rechecks selected coverage, and returns only the suburb for an outside waitlist", async () => {
    expect(await checkJobDraftLocationAction({ locationSource: "SEARCH", suburb: "Gladstone", point: INVERCARGILL_COVERAGE.centre })).toEqual({ status: "inside" });
    expect(await checkJobDraftLocationAction({ locationSource: "SEARCH", suburb: "Dunedin Central", point: { lat: -45.874, lng: 170.503 } })).toEqual({ status: "outside", suburb: "Dunedin Central" });
    expect(await checkJobDraftLocationAction({ locationSource: "TYPED", suburb: "Gladstone" })).toEqual({ status: "inside" });
  });
  it("does not accept incomplete/fabricated coordinates and fails honestly when coverage cannot load", async () => {
    expect(await checkJobDraftLocationAction({ locationSource: "SEARCH", suburb: "Gladstone" })).toEqual({ status: "invalid" });
    expect(await checkJobDraftLocationAction({ locationSource: "SEARCH", suburb: "Gladstone", point: { lat: 999, lng: 0 } })).toEqual({ status: "invalid" });
    vi.mocked(loadCoverage).mockRejectedValue(new Error("DB unavailable"));
    expect(await checkJobDraftLocationAction({ locationSource: "TYPED", suburb: "Gladstone" })).toEqual({ status: "unavailable" });
  });
  it("rate limits both guest search and coverage checks without profile or private-job reads", async () => {
    vi.mocked(consumeForClient).mockResolvedValue({ allowed: false, retryAfter: 60 });
    expect(await searchJobAddressesAction("12 Dee")).toEqual({ mode: "manual", reason: "unavailable" });
    expect(await checkJobDraftLocationAction({ locationSource: "TYPED", suburb: "Gladstone" })).toEqual({ status: "unavailable" });
  });
});
