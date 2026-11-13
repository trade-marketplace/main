import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DraftWhere, savedAddressMatches } from "@/components/jobs/DraftWhere";
import { initialWizardDraft } from "@/lib/post-job-wizard";
import type { SavedAddress } from "@/lib/account/addresses";
vi.mock("@/server/jobs/posting-actions", () => ({ copyDraftAddressAction: vi.fn(), listDraftAddressesAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const home: SavedAddress = { id: "ce61bba4-8123-4000-8000-000000000001", label: "Home", line1: "12 Campbell St", line2: null, suburb: "Windsor", city: "Invercargill", postcode: "9810", locationSource: "SEARCH", lat: -46.4132, lng: 168.3538, isDefault: true, createdAt: "2026-11-04T00:00:00Z" };
const draft = initialWizardDraft({ addressLine1: home.line1, suburb: home.suburb, city: home.city, postcode: home.postcode!, locationSource: "SEARCH", point: { lat: home.lat!, lng: home.lng! } });
const props = { draft, now: new Date("2026-11-04T00:00:00Z"), fields: {}, busy: false, offline: false, backHref: "/jobs/new?step=photos", onChange: vi.fn(), onNext: vi.fn(), onOutside: vi.fn() };
const saved = { addresses: [home], selectedId: home.id, copy: async () => ({ status: "unavailable" as const }) };
describe("saved address picker", () => {
  it("uses the kit's labelled radio cards and keeps schedule/access notes with the selected address", () => {
    const html = renderToStaticMarkup(<DraftWhere {...props} preview={{ saved }} />);
    expect(html).toContain('name="saved-job-address"'); expect(html).toMatch(new RegExp(`<input(?=[^>]*value="${home.id}")(?=[^>]*checked="")[^>]*>`));
    expect(html).toContain("Home"); expect(html).toContain("12 Campbell St, Windsor"); expect(html).toContain("Somewhere else"); expect(html).toContain('href="/profile/addresses"');
    expect(html).toContain("When are you free?"); expect(html).toContain("Anything else? (optional)"); expect(html).not.toContain('role="combobox"');
  });
  it("retains today's address search and typed fallback for no saved rows and Somewhere else", () => {
    for (const selection of [{ ...saved, addresses: [] }, { ...saved, selectedId: "other" }]) {
      const html = renderToStaticMarkup(<DraftWhere {...props} preview={{ manual: true, saved: selection }} />);
      expect(html).toContain('role="combobox"'); expect(html).toContain("Unit / flat (optional)"); expect(html).toContain("Suburb"); expect(html).toContain("City");
      if (!selection.addresses.length) { expect(html).not.toContain("Somewhere else"); expect(html).not.toContain("Manage addresses"); }
    }
  });
  it("disables network choices and Next offline while keeping saved address facts readable", () => {
    const html = renderToStaticMarkup(<DraftWhere {...props} offline preview={{ saved }} />);
    expect(html).toMatch(/<fieldset[^>]*disabled=""/); expect(html).toContain("12 Campbell St, Windsor"); expect(html.match(/<button[^>]*type="submit"[^>]*>/)?.[0]).toContain('aria-disabled="true"');
  });
  it("recognizes an independent current snapshot only when every address/location fact still matches", () => {
    expect(savedAddressMatches(draft, home)).toBe(true);
    for (const patch of [{ line1: "Changed" }, { line2: "Unit 2" }, { suburb: "Different" }, { city: "Different" }, { postcode: "9811" }, { lat: -46.4 }, { lng: 168.4 }, { locationSource: "TYPED" as const }]) expect(savedAddressMatches(draft, { ...home, ...patch })).toBe(false);
    expect(savedAddressMatches(initialWizardDraft({ addressLine1: home.line1, suburb: home.suburb, city: home.city, locationSource: "TYPED" }), { ...home, locationSource: "TYPED", postcode: null, lat: null, lng: null })).toBe(true);
  });
});
