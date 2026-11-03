import "server-only";

import type { Prisma, PrismaClient, Settings } from "@/generated/prisma/client";
import { COVERAGE_FIELDS, RATE_FIELDS, parseSettingsInput, settingsChanges, type CoverageCount, type SettingsPageData, type SettingsRecord, type SettingsResult, type SettingsValues } from "@/lib/office-settings";
import { haversineKm, type Point } from "@/lib/geo/distance";
import { createAudit } from "@/server/audit/audit";
import { priceWork, ratesForTrade } from "@/server/pricing/calculate";
import { getAddressSearchProvider, searchAddresses } from "@/server/geo/address-search";
import { officeUsers } from "./users";

type Actor = { userId: string };
export async function requireSettingsAdmin(db: Pick<Prisma.TransactionClient, "profile">, actor: Actor) {
  const current = await db.profile.findUnique({ where: { id: actor.userId }, select: { role: true } });
  if (current?.role !== "ADMIN") throw new Error("settings-forbidden");
}

export function settingsRecord(row: Settings): SettingsRecord {
  return { version: String(row.revision), enabledTrades: row.enabledTrades, values: Object.fromEntries([...RATE_FIELDS, ...COVERAGE_FIELDS].map(field => [field.key, row[field.key as keyof Settings]])) as SettingsValues };
}
export function settingsExamples(values: SettingsValues) {
  return { licensed: priceWork({ minutes: 240, materialsCents: 0 }, ratesForTrade("ELECTRICAL", values)).customerPriceCents, other: priceWork({ minutes: 60, materialsCents: 0 }, ratesForTrade("OTHER", values)).customerPriceCents };
}

export async function readOfficeSettings(db: PrismaClient, actor: Actor): Promise<SettingsPageData> {
  await requireSettingsAdmin(db, actor);
  const [row, people, evidence] = await Promise.all([
    db.settings.findUniqueOrThrow({ where: { id: 1 } }), officeUsers(db).list(),
    db.tradeEvidenceRule.findMany({ select: { trade: true, cocRequired: true, cocFileRequired: true, minPhotos: true, notesRequired: true } }),
  ]);
  const record = settingsRecord(row);
  return { record, examples: settingsExamples(record.values), team: people.map(person => ({ email: person.email, since: person.since?.toISOString() ?? null })), evidence };
}

export async function saveOfficeSettings(db: PrismaClient, actor: Actor, raw: unknown): Promise<SettingsResult> {
  const parsed = parseSettingsInput(raw);
  if (!parsed.ok) return { ok: false, error: "invalid", fields: parsed.fields };
  return db.$transaction(async tx => {
    await requireSettingsAdmin(tx, actor);
    const before = await tx.settings.findUniqueOrThrow({ where: { id: 1 } });
    if (String(before.revision) !== parsed.input.version) return { ok: false, error: "changed" };
    if (!settingsChanges(settingsRecord(before), parsed.input).length) return { ok: true, record: settingsRecord(before) };
    const update: Prisma.SettingsUpdateManyMutationInput = parsed.input.tab === "trades" ? { enabledTrades: { set: parsed.enabledTrades } } : parsed.values;
    const result = await tx.settings.updateMany({ where: { id: 1, revision: before.revision }, data: { ...update, revision: { increment: 1 }, updatedById: actor.userId } });
    if (result.count !== 1) return { ok: false, error: "changed" };
    const after = await tx.settings.findUniqueOrThrow({ where: { id: 1 } });
    const keys = parsed.input.tab === "trades" ? ["enabledTrades"] : Object.keys(parsed.values);
    const snapshot = (row: Settings) => Object.fromEntries(keys.map(key => [key, row[key as keyof Settings]])) as Record<string, Prisma.JsonValue>;
    await createAudit(tx)(actor, "settings.updated", { type: "settings", id: 1 }, snapshot(before), snapshot(after));
    return { ok: true, record: settingsRecord(after) };
  });
}

export function previewSettings(raw: unknown, current: SettingsRecord) {
  const parsed = parseSettingsInput(raw);
  return parsed.ok ? { ok: true as const, examples: settingsExamples({ ...current.values, ...parsed.values } as SettingsValues) } : { ok: false as const, fields: parsed.fields };
}

type SuburbLookup = (suburb: string, centre: Point) => Promise<Point | null>;
const suburbCache = new Map<string, { point: Point | null; expires: number }>();
const MAX_LOOKUPS = 20;
export const lookupWaitlistSuburb: SuburbLookup = async (suburb, centre) => {
  const key = `${suburb.toLowerCase()}:${centre.lat.toFixed(2)}:${centre.lng.toFixed(2)}`;
  const cached = suburbCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.point;
  const response = await searchAddresses(suburb, { provider: getAddressSearchProvider(process.env, ["locality", "neighborhood", "place"]), coverage: { name: "Coverage", centre, radiusKm: 200 }, limit: 3, onError: () => {} });
  const found = response.mode === "search" ? response.suggestions.find(item => [item.suburb, item.city].some(name => name.trim().toLowerCase() === suburb.trim().toLowerCase()))?.point ?? null : null;
  if (suburbCache.size >= 500) suburbCache.delete(suburbCache.keys().next().value!);
  suburbCache.set(key, { point: found, expires: Date.now() + 15 * 60_000 });
  return found;
};

/** Counts entries, not distinct suburbs. Unknown or ambiguous suburb centres remain explicitly unlocated. */
export async function countCoverageWaitlist(db: PrismaClient, actor: Actor, raw: unknown, lookup: SuburbLookup = lookupWaitlistSuburb): Promise<CoverageCount | null> {
  await requireSettingsAdmin(db, actor);
  const parsed = parseSettingsInput(raw);
  if (!parsed.ok || parsed.input.tab !== "coverage") return null;
  const centre = { lat: parsed.values.coverageCentreLat!, lng: parsed.values.coverageCentreLng! };
  const [rows, total] = await Promise.all([db.waitlistEntry.findMany({ take: 5000, select: { suburb: true }, orderBy: { createdAt: "desc" } }), db.waitlistEntry.count()]);
  const suburbs = new Map<string, number>();
  rows.forEach(row => suburbs.set(row.suburb, (suburbs.get(row.suburb) ?? 0) + 1));
  let inside = 0, located = 0;
  const entries = [...suburbs.entries()].slice(0, MAX_LOOKUPS);
  for (let offset = 0; offset < entries.length; offset += 4) {
    await Promise.all(entries.slice(offset, offset + 4).map(async ([suburb, count]) => {
      const point = await lookup(suburb, centre).catch(() => null);
      if (!point) return;
      located += count;
      if (haversineKm(centre, point) <= parsed.values.coverageRadiusKm!) inside += count;
    }));
  }
  return { inside, unlocated: total - located, total };
}
