import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import Home from "@/app/(site)/page";
import { INVERCARGILL_COVERAGE } from "@/lib/geo/coverage";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/geo/coverage-settings", () => ({ loadCoverage: async () => INVERCARGILL_COVERAGE }));
vi.mock("@/server/landing", () => ({ LANDING_ILLUSTRATION_CENTS: 37200, LANDING_EXAMPLE_REVIEWS: [{ id: 'example', rating: 5, name: 'Example', comment: 'Example review text' }], landingReviews: async () => [] }));

describe("public homepage", async () => {
  const html = renderToString(await Home());

  it("renders the designed headline, all job categories and approved hand-offs", () => {
    expect(html).toMatch(/<h1[^>]*>.*Sorted in.*a flash\./);
    for (const name of ["Electrical", "Plumbing", "Gas fitting", "Construction", "Other"]) expect(html).toContain(name);
    expect(html).toContain("/jobs/new?");
    expect(html).toContain("You do the work.");
    expect(html).toContain("We find the jobs.");
    expect(html).toContain("reviews-heading");
    expect(html).toContain("Example reviews");
  });

  it("keeps the bolt artwork hidden from screen readers", () => {
    const svgs = html.match(/<svg[^>]*>/g) ?? [];
    expect(svgs.length).toBe(2);
    for (const svg of svgs) expect(svg).toContain('aria-hidden="true"');
  });
});
