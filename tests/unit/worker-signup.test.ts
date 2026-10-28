import { describe, expect, it } from "vitest";

import { parseWorkerSignup, readWorkerSignupForm } from "@/lib/auth/worker-signup";

const base = { trades: ["OTHER"], licences: {}, baseSuburb: "Invercargill", radiusKm: "25", point: null };

describe("worker signup", () => {
  it("Other alone requires no licence and keeps verification out of the signup payload", () => {
    expect(parseWorkerSignup(base)).toEqual({ ok: true, details: { ...base, radiusKm: 25 } });
  });

  it("accepts multiple trades and only retains licences for selected restricted trades", () => {
    const result = parseWorkerSignup({ ...base, trades: ["ELECTRICAL", "GAS", "OTHER", "GAS"], licences: { ELECTRICAL: "e 12345", GAS: "pgdb 44120", OTHER: "ignored" } });
    expect(result).toMatchObject({ ok: true, details: { trades: ["ELECTRICAL", "GAS", "OTHER"], licences: { ELECTRICAL: "E 12345", GAS: "PGDB 44120" } } });
    if (result.ok) expect(result.details.licences).not.toHaveProperty("OTHER");
  });

  it.each([
    ["ELECTRICAL", "E 12345"], ["ELECTRICAL", "e123456"], ["ELECTRICAL", "ew 012345"],
    ["PLUMBING", "98211"], ["PLUMBING", "pgd 98211"], ["GAS", "PGDB 44120"],
    ["CONSTRUCTION", "BP 104635"], ["CONSTRUCTION", "104635"],
  ])("accepts documented %s number %s without claiming authenticity", (trade, number) => {
    expect(parseWorkerSignup({ ...base, trades: [trade], licences: { [trade]: number } })).toMatchObject({ ok: true });
  });

  it.each(["ELECTRICAL", "PLUMBING", "GAS", "CONSTRUCTION"])("%s malformed number gives an inline example", (trade) => {
    const result = parseWorkerSignup({ ...base, trades: [trade], licences: { [trade]: "wrong-number!" } });
    expect(result).toMatchObject({ ok: false, errors: { [`licence_${trade}`]: expect.stringMatching(/Use (?:E |PGDB |BP )/) } });
  });

  it("requires selected trade, work suburb and a supported travel radius", () => {
    expect(parseWorkerSignup({ ...base, trades: [], baseSuburb: "", radiusKm: "100" })).toMatchObject({ ok: false, errors: { trades: expect.any(String), baseSuburb: expect.any(String), radiusKm: expect.any(String) } });
    expect(parseWorkerSignup({ ...base, trades: ["ADMIN"] })).toMatchObject({ ok: false });
    expect(parseWorkerSignup({ ...base, point: { lat: 999, lng: 0 } })).toMatchObject({ ok: false, errors: { baseSuburb: expect.any(String) } });
  });

  it("reads multi-select inputs, coordinates and only known licence fields", () => {
    const form = new FormData();
    form.append("trades", "ELECTRICAL"); form.append("trades", "OTHER");
    form.set("licence_ELECTRICAL", "E 123456"); form.set("baseSuburb", "Windsor, Invercargill"); form.set("radiusKm", "50");
    form.set("areaLat", "-46.391"); form.set("areaLng", "168.367");
    expect(readWorkerSignupForm(form)).toMatchObject({ trades: ["ELECTRICAL", "OTHER"], licences: { ELECTRICAL: "E 123456" }, radiusKm: "50", point: { lat: -46.391, lng: 168.367 } });
  });
});
