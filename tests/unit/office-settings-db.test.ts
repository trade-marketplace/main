import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Role } from "@/generated/prisma/client";
import { COVERAGE_FIELDS, RATE_FIELDS, TRADES, displayNumber, type SettingsInput } from "@/lib/office-settings";
import { readOfficeSettings, saveOfficeSettings, countCoverageWaitlist } from "@/server/office/settings";
import { officeUsers } from "@/server/office/users";
import { priceJob } from "@/server/pricing/price-job";
import { postJob } from "@/server/jobs/post-job";
import { transitionJob } from "@/server/jobs/status-machine";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("office settings (database)", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: Role = "ADMIN") {
    const id = randomUUID(); await schema.db.$executeRaw`INSERT INTO auth.users (id) VALUES (${id}::uuid)`;
    return schema.db.profile.create({ data: { id, email: `${id}@example.nz`, firstName: "Test", role, emailVerifiedAt: new Date() } });
  }
  async function input(actor: { userId: string }, tab: "rates" | "coverage" = "rates"): Promise<SettingsInput> {
    const { record } = await readOfficeSettings(schema.db, actor);
    return { tab, version: record.version, values: Object.fromEntries((tab === "rates" ? RATE_FIELDS : COVERAGE_FIELDS).map(field => [field.key, displayNumber(field, record.values[field.key])])) };
  }
  async function job(category: "OTHER" | "ELECTRICAL" = "OTHER", status: "REVIEW" | "BOOKABLE" = "REVIEW") {
    return schema.db.job.create({ data: { customerId: (await person("CUSTOMER")).id, category, status, title: "Move a sofa", description: "Move a sofa upstairs.", addressLine1: "1 Example St", suburb: "Gladstone", city: "Invercargill", priceCents: status === "BOOKABLE" ? 10000 : null } });
  }
  it("saves and audits only changed fields with the actual office actor", async () => {
    const actor = { userId: (await person()).id }; const data = await input(actor);
    data.values.sharedRateCents = "75.25";
    expect(await saveOfficeSettings(schema.db, actor, data)).toMatchObject({ ok: true, record: { values: { sharedRateCents: 7525 } } });
    const audit = await schema.db.auditLog.findFirstOrThrow({ where: { action: "settings.updated", actorId: actor.userId } });
    expect(audit).toMatchObject({ actorRole: "ADMIN", before: { sharedRateCents: 7000 }, after: { sharedRateCents: 7525 } });
  });
  it("rate changes never rewrite an already-priced job's frozen rates or price", async () => {
    const actor = { userId: (await person()).id }; const existing = await job();
    await priceJob(schema.db, { jobId: existing.id, minutes: 120, materialsCents: 0 });
    const frozen = await schema.db.jobPricing.findUniqueOrThrow({ where: { jobId: existing.id } });
    const old = await schema.db.job.findUniqueOrThrow({ where: { id: existing.id } });
    const data = await input(actor); data.values.otherRateCents = "55"; data.values.marginBps = "30";
    expect((await saveOfficeSettings(schema.db, actor, data)).ok).toBe(true);
    expect(await schema.db.jobPricing.findUniqueOrThrow({ where: { jobId: existing.id } })).toEqual(frozen);
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: existing.id } })).priceCents).toBe(old.priceCents);
    const later = await job(); const priced = await priceJob(schema.db, { jobId: later.id, minutes: 120, materialsCents: 0 });
    expect(priced.ok && priced.breakdown.customerPriceCents).not.toBe(old.priceCents);
  });
  it("refuses stale edits, invalid numbers and stale authorization without changing data", async () => {
    const actor = { userId: (await person()).id }; const data = await input(actor);
    const first = { ...data, values: { ...data.values, gstBps: "14" } }, second = { ...data, values: { ...data.values, gstBps: "16" } };
    const results = await Promise.all([saveOfficeSettings(schema.db, actor, first), saveOfficeSettings(schema.db, actor, second)]);
    expect(results.filter(result => result.ok)).toHaveLength(1); expect(results.filter(result => !result.ok && result.error === "changed")).toHaveLength(1);
    expect(await saveOfficeSettings(schema.db, actor, { ...await input(actor), values: { ...data.values, sharedRateCents: "-5" } })).toMatchObject({ ok: false, error: "invalid" });
    const current = await input(actor); await schema.db.profile.update({ where: { id: actor.userId }, data: { role: "CUSTOMER" } });
    await expect(saveOfficeSettings(schema.db, actor, current)).rejects.toThrow("settings-forbidden");
  });
  it("leaves unchanged settings untouched and supports the nullable, configuration-only bonus", async () => {
    const actor = { userId: (await person()).id }; const data = await input(actor);
    const result = await saveOfficeSettings(schema.db, actor, data);
    expect(result).toMatchObject({ ok: true, record: { version: data.version } });
    expect(await schema.db.auditLog.count({ where: { actorId: actor.userId } })).toBe(0);
    data.values.quoterBonusCents = "20"; expect((await saveOfficeSettings(schema.db, actor, data)).ok).toBe(true);
    expect((await schema.db.settings.findUniqueOrThrow({ where: { id: 1 } })).quoterBonusCents).toBe(2000);
    const clear = await input(actor); clear.values.quoterBonusCents = "";
    expect((await saveOfficeSettings(schema.db, actor, clear)).ok).toBe(true);
  });
  it("disabled trades refuse new posts and claims, while existing work remains editable", async () => {
    const actor = { userId: (await person()).id }; const customer = await person("CUSTOMER"); const worker = await person("TRADIE");
    const existing = await job("OTHER", "BOOKABLE"); const { record } = await readOfficeSettings(schema.db, actor);
    expect((await saveOfficeSettings(schema.db, actor, { tab: "trades", values: {}, version: record.version, enabledTrades: TRADES.filter(trade => trade !== "OTHER") })).ok).toBe(true);
    const viewer = { userId: customer.id, role: "CUSTOMER" as const, email: customer.email, firstName: customer.firstName, emailVerified: true };
    const key = randomUUID();
    expect(await postJob(schema.db, viewer, { description: "Move a sofa upstairs", category: "OTHER", photoPaths: [], addressLine1: "1 Example St", suburb: "Gladstone", city: "Invercargill", locationSource: "TYPED", anyTime: true }, key, { rateLimit: async () => ({ allowed: true }) })).toEqual({ status: "trade-unavailable" });
    await expect(transitionJob(schema.db, { audit: async () => {}, notify: async () => {} }, { jobId: existing.id, transition: "claim", actor: { role: "TRADIE", userId: worker.id } })).rejects.toMatchObject({ failure: "trade-unavailable" });
    await schema.db.job.update({ where: { id: existing.id }, data: { description: "Updated existing work details." } });
    await expect(job()).rejects.toThrow();
    await schema.db.settings.update({ where: { id: 1 }, data: { enabledTrades: [...TRADES] } });
  });
  it("counts known suburb centres and reports every unlocated entry separately", async () => {
    const actor = { userId: (await person()).id };
    for (const suburb of ["Inside", "Inside", "Outside", "Unknown"]) await schema.db.waitlistEntry.create({ data: { email: `${randomUUID()}@example.nz`, suburb, suburbKey: suburb.toLowerCase() } });
    const data = await input(actor, "coverage");
    const centre = { lat: Number(data.values.coverageCentreLat), lng: Number(data.values.coverageCentreLng) };
    const lookup = vi.fn(async (suburb: string) => suburb === "Inside" ? centre : suburb === "Outside" ? { lat: -36.85, lng: 174.76 } : null);
    expect(await countCoverageWaitlist(schema.db, actor, data, lookup)).toEqual({ inside: 2, unlocated: 1, total: 4 });
    expect(lookup).toHaveBeenCalledTimes(3);
    expect(await countCoverageWaitlist(schema.db, actor, data, async () => { throw new Error("provider down"); })).toEqual({ inside: 0, unlocated: 4, total: 4 });
  });
  it("reuses safe Team changes with actual actors and refuses a revoked administrator", async () => {
    const actor = { userId: (await person()).id }, target = await person("CUSTOMER");
    const revoke = vi.fn(async () => {}); const users = officeUsers(schema.db, revoke, actor);
    expect(await users.add(target.email)).toMatchObject({ role: "ADMIN", changed: true });
    const audit = await schema.db.auditLog.findFirstOrThrow({ where: { action: "office_user.added", recordId: target.id } });
    expect(audit).toMatchObject({ actorId: actor.userId, actorRole: "ADMIN", reason: null });
    expect(await users.remove(target.email)).toMatchObject({ role: "CUSTOMER", changed: true }); expect(revoke).toHaveBeenCalledOnce();
    await schema.db.profile.update({ where: { id: actor.userId }, data: { role: "CUSTOMER" } });
    await expect(users.add(target.email)).rejects.toMatchObject({ code: "forbidden" });
  });
});
