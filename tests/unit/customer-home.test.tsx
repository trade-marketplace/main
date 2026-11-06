import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CustomerHome } from "@/components/home/CustomerHome";
import { CATEGORIES } from "@/lib/cards";
import { homeJobHref, type CustomerHomeData } from "@/lib/customer-home";
import { INVERCARGILL_COVERAGE } from "@/lib/geo/coverage";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const empty: CustomerHomeData = { firstName: "Sarah", coverage: INVERCARGILL_COVERAGE, location: { label: "", point: null }, outside: false, categories: CATEGORIES, needsYou: [], inProgress: [], recent: [], counts: { needsYou: 0, inProgress: 0 } };

describe("customer home", () => {
  it("hides Needs you for an empty customer and explains all three steps", () => {
    const html = renderToStaticMarkup(<CustomerHome result={{ ok: true, data: empty }} />);
    expect(html).not.toContain('id="needs-heading"');
    for (const copy of ["Nothing on yet.", "Post it", "Accept the price", "Sorted"]) expect(html).toContain(copy);
    expect(html).not.toMatch(/estimate|margin|workerGross|earnCents/i);
  });
  it("offers the waitlist without claiming an unknown saved location is outside", () => {
    expect(renderToStaticMarkup(<CustomerHome result={{ ok: true, data: empty }} />)).not.toContain("Join the waitlist");
    expect(renderToStaticMarkup(<CustomerHome result={{ ok: true, data: { ...empty, outside: true, location: { label: "Dunedin", point: { lat: -45.87, lng: 170.5 } } } }} />)).toContain("/coming-soon?");
  });
  it("keeps error and loading distinct from an empty customer", () => {
    const failed = renderToStaticMarkup(<CustomerHome result={{ ok: false }} />);
    expect(failed).toContain("Can’t load your jobs"); expect(failed).not.toContain("Nothing on yet.");
    const loading = renderToStaticMarkup(<CustomerHome result={{ ok: false }} loading />);
    expect(loading).toContain('aria-busy="true"'); expect(loading).not.toContain("Can’t load your jobs");
  });
  it("canonicalizes home row links without accepting a user-controlled return URL", () => {
    expect(homeJobHref("11500000-0000-4000-8000-000000000001")).toBe("/jobs/11500000-0000-4000-8000-000000000001?from=%2F");
  });
});
