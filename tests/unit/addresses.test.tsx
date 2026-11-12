import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Addresses, AddressesLoading } from "@/components/account/Addresses";
import { addressInput, addressLines, parseAddress, type SavedAddress } from "@/lib/account/addresses";

vi.mock("@/server/account/address-actions", () => ({ listAddressesAction: vi.fn(), saveAddressAction: vi.fn(), deleteAddressAction: vi.fn(), setDefaultAddressAction: vi.fn() }));
vi.mock("@/server/jobs/address-actions", () => ({ searchJobAddressesAction: vi.fn() }));
const row: SavedAddress = { id: "23700000-0000-4000-8000-000000000001", label: "Home", line1: "12 Dee Street", line2: "Unit 2", suburb: "Central", city: "Invercargill", postcode: "9810", lat: -46.4, lng: 168.3, locationSource: "SEARCH", isDefault: true, createdAt: "2026-11-12T00:00:00Z" };
describe("saved address validation and presentation", () => {
  it("accepts a search selection with coordinates and trims optional label/unit fields", () => {
    expect(parseAddress({ ...addressInput(row), label: " Home ", line2: " Unit 2 " })).toMatchObject({ ok: true, data: { label: "Home", line2: "Unit 2", point: { lat: -46.4, lng: 168.3 } } });
  });
  it("accepts typed fallback without coordinates but rejects an invented typed point", () => {
    expect(parseAddress({ ...addressInput(row), locationSource: "TYPED", point: null }).ok).toBe(true);
    expect(parseAddress({ ...addressInput(row), locationSource: "TYPED" })).toMatchObject({ ok: false, fields: { line1: "Type the address again without a location." } });
    expect(parseAddress({ ...addressInput(row), point: null })).toMatchObject({ ok: false, fields: { line1: "Choose an address from the search results." } });
  });
  it("requires the street, suburb and city and bounds labels/postcodes/points", () => {
    expect(parseAddress({ ...addressInput(), label: "x".repeat(41) })).toMatchObject({ ok: false, fields: { label: "Use 40 characters or fewer.", line1: "Enter the address.", suburb: "Enter the suburb.", city: "Enter the city." } });
    for (const point of [{ lat: 91, lng: 168 }, { lat: -46, lng: Infinity }, { lat: NaN, lng: 168 }]) expect(parseAddress({ ...addressInput(row), point }).ok).toBe(false);
    expect(parseAddress({ ...addressInput(row), postcode: "981" })).toMatchObject({ ok: false, fields: { postcode: "Enter a 4-digit postcode." } });
    expect(parseAddress({ ...addressInput(row), label: "", postcode: "" }).ok).toBe(true);
  });
  it("allows legacy provenance only for an existing id and preserves its point in the edit form", () => {
    const old = { ...row, locationSource: "PIN" as const };
    expect(addressInput(old)).toMatchObject({ locationSource: null, point: { lat: -46.4, lng: 168.3 } });
    expect(parseAddress(addressInput(old)).ok).toBe(true);
    expect(parseAddress({ ...addressInput(old), id: undefined }).ok).toBe(false);
  });
  it("shows two address lines, a default pill and no Make default for that card", () => {
    expect(addressLines(row)).toEqual(["Unit 2, 12 Dee Street", "Central, Invercargill, 9810"]);
    const html = renderToStaticMarkup(<Addresses initial={[row]} />);
    expect(html).toContain("Default"); expect(html).not.toContain("Make default"); expect(html).toContain("Unit 2, 12 Dee Street");
    expect(renderToStaticMarkup(<Addresses initial={[{ ...row, label: null }]} />)).toContain(">Address</h2>");
  });
  it("provides one primary Add address action when empty and an explained limit at ten", () => {
    const empty = renderToStaticMarkup(<Addresses initial={[]} />);
    expect(empty).toContain("No saved addresses yet."); expect(empty.match(/>Add address</g)).toHaveLength(1);
    const atLimit = renderToStaticMarkup(<Addresses initial={Array.from({ length: 10 }, (_, i) => ({ ...row, id: `${row.id}-${i}`, isDefault: i === 0 }))} />);
    expect(atLimit).toContain("You can save up to 10 addresses."); expect(atLimit).toMatch(/aria-disabled="true"/);
  });
  it("announces loading separately from its busy skeleton and offers a load retry", () => {
    expect(renderToStaticMarkup(<AddressesLoading />)).toContain('aria-busy="true"');
    expect(renderToStaticMarkup(<Addresses initial={null} />)).toContain("Couldn’t load your addresses.");
  });
});
