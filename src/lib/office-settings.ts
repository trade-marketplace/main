import { z } from "zod";

export const SETTINGS_TABS = ["rates", "trades", "coverage", "team", "emails"] as const;
export type SettingsTab = typeof SETTINGS_TABS[number];
export const TRADES = ["ELECTRICAL", "PLUMBING", "GAS", "CONSTRUCTION", "OTHER"] as const;
export const TRADE_NAMES = { ELECTRICAL: "Electrical", PLUMBING: "Plumbing", GAS: "Gas fitting", CONSTRUCTION: "Construction", OTHER: "Other / general labour" };
export type NumberField = { key: string; label: string; unit: "money" | "percent" | "hours" | "number"; min: number; max: number; nullable?: boolean; group: string };
export const RATE_FIELDS: readonly NumberField[] = [
  { key: "sharedRateCents", label: "Tradie hourly rate", unit: "money", min: 1, max: 1000, group: "Licensed trades" },
  { key: "sharedMinMinutes", label: "Minimum hours", unit: "hours", min: .25, max: 24, group: "Licensed trades" },
  { key: "otherRateCents", label: "Tradie hourly rate", unit: "money", min: 1, max: 1000, group: "Other / general labour" },
  { key: "otherMinMinutes", label: "Minimum hours", unit: "hours", min: .25, max: 24, group: "Other / general labour" },
  { key: "holidayPayBps", label: "Holiday pay", unit: "percent", min: 0, max: 100, group: "Shared" },
  { key: "onCostBps", label: "On-costs", unit: "percent", min: 0, max: 100, group: "Shared" },
  { key: "marginBps", label: "Customer margin", unit: "percent", min: 0, max: 100, group: "Shared" },
  { key: "gstBps", label: "GST", unit: "percent", min: 0, max: 100, group: "Shared" },
  { key: "autoReleaseHours", label: "Auto-release hours", unit: "number", min: 1, max: 720, group: "Timing and quote bounties" },
  { key: "quickLookPriceCents", label: "Quick-look price", unit: "money", min: 0, max: 10000, group: "Timing and quote bounties" },
  { key: "bountyAmountCents", label: "Bounty amount", unit: "money", min: 0, max: 10000, group: "Timing and quote bounties" },
  { key: "bountyExpiryHours", label: "Bounty expiry hours", unit: "number", min: 1, max: 720, group: "Timing and quote bounties" },
  { key: "quoterRewardBps", label: "Quoter reward", unit: "percent", min: 0, max: 100, group: "Timing and quote bounties" },
  { key: "quoterBonusCents", label: "Weekly quoter bonus", unit: "money", min: 0, max: 10000, nullable: true, group: "Timing and quote bounties" },
  { key: "starterPoints", label: "Starting points", unit: "number", min: 0, max: 100, group: "Quote points" },
  { key: "quotePoints", label: "Points per quote", unit: "number", min: 0, max: 100, group: "Quote points" },
  { key: "claimPoints", label: "Points to claim a job", unit: "number", min: 0, max: 100, group: "Quote points" },
];
export const COVERAGE_FIELDS: readonly NumberField[] = [
  { key: "coverageCentreLat", label: "Centre latitude", unit: "number", min: -48, max: -33, group: "Coverage" },
  { key: "coverageCentreLng", label: "Centre longitude", unit: "number", min: 165, max: 179.99, group: "Coverage" },
  { key: "coverageRadiusKm", label: "Radius (km)", unit: "number", min: 1, max: 200, group: "Coverage" },
];
export type SettingsValues = Record<string, number | null> & { sharedRateCents: number; otherRateCents: number; sharedMinMinutes: number; otherMinMinutes: number; holidayPayBps: number; onCostBps: number; marginBps: number; gstBps: number; coverageCentreLat: number; coverageCentreLng: number; coverageRadiusKm: number };
export type SettingsRecord = { values: SettingsValues; enabledTrades: string[]; version: string };
export type SettingsInput = { tab: "rates" | "trades" | "coverage"; values: Record<string, string>; enabledTrades?: string[]; version: string };
export type SettingsChange = { field: string; before: string; after: string };
export type SettingsResult = { ok: true; record: SettingsRecord } | { ok: false; error: "invalid" | "changed" | "unavailable" | "forbidden"; fields?: Record<string, string> };
export type PriceExamples = { licensed: number; other: number };
export type CoverageCount = { inside: number; unlocated: number; total: number };
export type SettingsPageData = { record: SettingsRecord; examples: PriceExamples; team: { email: string; since: string | null }[]; evidence: { trade: string; cocRequired: boolean; cocFileRequired: boolean; minPhotos: number; notesRequired: boolean }[] };

export function displayNumber(field: NumberField, value: number | null): string {
  if (value === null) return "";
  const divisor = field.unit === "money" || field.unit === "percent" ? 100 : field.unit === "hours" ? 60 : 1;
  return String(value / divisor);
}
export function formatSetting(field: NumberField, value: number | null): string {
  if (value === null) return "Not set";
  const n = displayNumber(field, value);
  return field.unit === "money" ? `$${Number(n).toFixed(2)}` : field.unit === "percent" ? `${n}%` : field.unit === "hours" ? `${n} h` : n;
}
const envelope = z.object({ tab: z.enum(["rates", "trades", "coverage"]), values: z.record(z.string(), z.string()), enabledTrades: z.array(z.enum(TRADES)).max(5).optional(), version: z.string().regex(/^\d+$/) }).strict();
export type ParsedSettingsInput = { ok: false; fields: Record<string, string> } | { ok: true; input: SettingsInput; values: Record<string, number | null>; enabledTrades?: (typeof TRADES[number])[] };
export function parseSettingsInput(raw: unknown): ParsedSettingsInput {
  const parsed = envelope.safeParse(raw);
  if (!parsed.success) return { ok: false, fields: { form: "Check the highlighted fields." } } as const;
  const input = parsed.data;
  if (input.tab === "trades") {
    if (!input.enabledTrades || new Set(input.enabledTrades).size !== input.enabledTrades.length || Object.keys(input.values).length) return { ok: false, fields: { form: "Choose the trades available for new jobs." } } as const;
    return { ok: true, input, values: {}, enabledTrades: input.enabledTrades } as const;
  }
  const fields = input.tab === "rates" ? RATE_FIELDS : COVERAGE_FIELDS;
  const errors: Record<string, string> = {}, values: Record<string, number | null> = {};
  if (Object.keys(input.values).some(key => !fields.some(field => field.key === key))) errors.form = "Check the highlighted fields.";
  for (const field of fields) {
    const text = input.values[field.key]?.trim() ?? "";
    if (field.nullable && !text) { values[field.key] = null; continue; }
    const number = Number(text), multiplier = field.unit === "money" || field.unit === "percent" ? 100 : field.unit === "hours" ? 60 : 1;
    const scaled = Math.round(number * multiplier);
    const decimalCoordinate = field.key === "coverageCentreLat" || field.key === "coverageCentreLng";
    if (!/^-?\d+(\.\d{1,6})?$/.test(text) || !Number.isFinite(number) || number < field.min || number > field.max || (!decimalCoordinate && Math.abs(number * multiplier - scaled) > .000001)) errors[field.key] = `Enter ${field.label.toLowerCase()} from ${field.min} to ${field.max}.`;
    else values[field.key] = decimalCoordinate ? number : scaled;
  }
  return Object.keys(errors).length ? { ok: false, fields: errors } as const : { ok: true, input, values, enabledTrades: undefined } as const;
}
export function settingsChanges(record: SettingsRecord, input: SettingsInput): SettingsChange[] {
  const parsed = parseSettingsInput(input);
  if (!parsed.ok) return [];
  if (input.tab === "trades") return TRADES.filter(trade => record.enabledTrades.includes(trade) !== parsed.enabledTrades?.includes(trade)).map(trade => ({ field: TRADE_NAMES[trade], before: record.enabledTrades.includes(trade) ? "On" : "Off", after: parsed.enabledTrades?.includes(trade) ? "On" : "Off" }));
  return (input.tab === "rates" ? RATE_FIELDS : COVERAGE_FIELDS).filter(field => parsed.values[field.key] !== record.values[field.key]).map(field => ({ field: field.group === "Licensed trades" || field.group === "Other / general labour" ? `${field.group}: ${field.label}` : field.label, before: formatSetting(field, record.values[field.key]), after: formatSetting(field, parsed.values[field.key]) }));
}
