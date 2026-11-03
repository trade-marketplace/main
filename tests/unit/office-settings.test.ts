import { describe, expect, it } from "vitest";
import { COVERAGE_FIELDS, RATE_FIELDS, TRADES, displayNumber, parseSettingsInput, settingsChanges, type SettingsInput } from "@/lib/office-settings";
import { officeSettingsPreview } from "@/app/dev/components/office-settings/preview-data";
import { previewSettings } from "@/server/office/settings";

const record = officeSettingsPreview().record;
function input(tab: "rates" | "coverage" = "rates"): SettingsInput {
  return { tab, version: record.version, values: Object.fromEntries((tab === "rates" ? RATE_FIELDS : COVERAGE_FIELDS).map(field => [field.key, displayNumber(field, record.values[field.key])])) };
}
describe("office settings validation and confirmations", () => {
  it("converts displayed dollars, percentages and hours to exact stored units", () => {
    const data = input(); data.values.sharedRateCents = "72.50"; data.values.marginBps = "22.25"; data.values.sharedMinMinutes = "1.25";
    expect(parseSettingsInput(data)).toMatchObject({ ok: true, values: { sharedRateCents: 7250, marginBps: 2225, sharedMinMinutes: 75, quoterBonusCents: null } });
  });
  it("bounds every numeric field and rejects blanks, nonnumbers and unsupported precision", () => {
    for (const field of [...RATE_FIELDS, ...COVERAGE_FIELDS]) {
      const data = input(field.group === "Coverage" ? "coverage" : "rates");
      for (const invalid of [String(field.max + 1), String(field.min - 1), "NaN", "Infinity", "1e2"]) {
        data.values[field.key] = invalid;
        expect(parseSettingsInput(data), `${field.key}: ${invalid}`).toMatchObject({ ok: false, fields: { [field.key]: expect.any(String) } });
      }
    }
    const data = input(); data.values.sharedRateCents = "1.001";
    expect(parseSettingsInput(data).ok).toBe(false);
    data.values.sharedRateCents = ""; expect(parseSettingsInput(data).ok).toBe(false);
  });
  it("accepts only known fields and unique launch trades", () => {
    expect(parseSettingsInput({ ...input(), values: { ...input().values, actorId: "bad" } }).ok).toBe(false);
    expect(parseSettingsInput({ tab: "trades", version: "0", values: {}, enabledTrades: ["OTHER", "OTHER"] }).ok).toBe(false);
    expect(parseSettingsInput({ tab: "trades", version: "0", values: {}, enabledTrades: [] }).ok).toBe(true);
    expect(parseSettingsInput({ tab: "trades", version: "0", values: {}, enabledTrades: [...TRADES, "NEW"] }).ok).toBe(false);
  });
  it("lists exactly the old and new values, including trade availability and unset bonuses", () => {
    const data = input(); data.values.sharedRateCents = "75"; data.values.quoterBonusCents = "10";
    expect(settingsChanges(record, data)).toEqual([{ field: "Licensed trades: Tradie hourly rate", before: "$70.00", after: "$75.00" }, { field: "Weekly quoter bonus", before: "Not set", after: "$10.00" }]);
    expect(settingsChanges(record, { tab: "trades", version: "0", values: {}, enabledTrades: TRADES.filter(trade => trade !== "OTHER") })).toEqual([{ field: "Other / general labour", before: "On", after: "Off" }]);
    expect(settingsChanges(record, input())).toEqual([]);
  });
  it("calculates example prices on the server from the proposed rates", () => {
    expect(previewSettings(input(), record)).toEqual({ ok: true, examples: { licensed: 46948, other: 6371 } });
    const data = input(); data.values.sharedRateCents = "80";
    const result = previewSettings(data, record);
    expect(result.ok && result.examples.licensed).toBeGreaterThan(46948);
  });
});
