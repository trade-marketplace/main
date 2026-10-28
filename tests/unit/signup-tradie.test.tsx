import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import TradieSignupPage from "@/app/signup/tradie/page";
import { SignupDetails } from "@/components/auth/CustomerSignup";
import { WorkerSignupFields } from "@/components/auth/WorkerSignupFields";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("tradie signup", () => {
  it("uses trade colours, the approved tradie line and linked worker terms", () => {
    const html = renderToString(<SignupDetails role="tradie" />);
    expect(html).toContain('data-mode="trade"');
    expect(html).toContain("You do the work. We find the jobs.");
    expect(html).toContain('href="/legal/tradie-terms"');
    expect(html).toContain('name="role" value="TRADIE"');
    expect(html).toContain("Step 2 of 3");
    expect(html).toMatch(/>Next<\/span>/);
  });
  it("Other alone shows no licence field and includes all five chips and travel radii", () => {
    const html = renderToString(<WorkerSignupFields values={{ trades: "OTHER" }} attempt={0} />);
    for (const name of ["Electrical", "Plumbing", "Gas fitting", "Construction", "Other", "10 km", "25 km", "50 km"]) expect(html).toContain(name);
    expect(html).not.toMatch(/name="licence_/);
    expect(html).not.toContain("Browse jobs straight away");
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-label="What do you do?"');
    expect(html).toMatch(/<legend[^>]*hidden=""/);
  });
  it("each restricted trade has its own field, example and inline error association", () => {
    const html = renderToString(<WorkerSignupFields values={{ trades: "ELECTRICAL,GAS" }} errors={{ licence_ELECTRICAL: "Use a number like E 123456 or EW012345." }} attempt={0} />);
    expect(html).toContain('name="licence_ELECTRICAL"');
    expect(html).toContain('name="licence_GAS"');
    expect(html).not.toContain('name="licence_PLUMBING"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("Use a number like E 123456");
  });
  it("keeps safe next paths on either step and refuses external redirects", async () => {
    const html = renderToString(await TradieSignupPage({ searchParams: Promise.resolve({ next: "/jobs?view=map", step: "trade" }) }));
    expect(html).toContain("Your trade");
    expect(html).toContain("Step 3 of 3");
    expect(html).toContain('name="next" value="/jobs?view=map"');
    const unsafe = renderToString(await TradieSignupPage({ searchParams: Promise.resolve({ next: "//evil.test" }) }));
    expect(unsafe).not.toContain("evil.test");
  });
});
