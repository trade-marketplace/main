import { TRADES, type SettingsPageData } from "@/lib/office-settings";
import { settingsExamples } from "@/server/office/settings";

export function officeSettingsPreview(): SettingsPageData {
  const values = { sharedRateCents: 7000, otherRateCents: 3800, sharedMinMinutes: 120, otherMinMinutes: 60, holidayPayBps: 800, onCostBps: 1250, marginBps: 2000, gstBps: 1500, autoReleaseHours: 48, quickLookPriceCents: 3000, bountyAmountCents: 3000, bountyExpiryHours: 24, quoterRewardBps: 200, quoterBonusCents: null, starterPoints: 3, quotePoints: 1, claimPoints: 5, coverageCentreLat: -46.4132, coverageCentreLng: 168.3538, coverageRadiusKm: 60 };
  return { record: { values, version: "0", enabledTrades: [...TRADES] }, examples: settingsExamples(values), team: [{ email: "matt@demo.test", since: "2026-10-23T00:00:00.000Z" }, { email: "william@demo.test", since: "2026-10-23T00:00:00.000Z" }], evidence: TRADES.map(trade => ({ trade, cocRequired: trade === "ELECTRICAL", cocFileRequired: trade === "ELECTRICAL", minPhotos: 1, notesRequired: true })) };
}
