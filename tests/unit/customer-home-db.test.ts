import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { JobStatus, Role } from "@/generated/prisma/client";
import type { Viewer } from "@/server/auth/viewer";
import { loadCustomerHome } from "@/server/customer-home";
import { INVERCARGILL_COVERAGE } from "@/lib/geo/coverage";
import { priceJob } from "@/server/pricing/price-job";
import { priceVariation } from "@/server/variations/price";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("customer home with PostgreSQL", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: Role = "CUSTOMER"): Promise<Viewer> {
    const id = randomUUID();
    await schema.db.$executeRaw`INSERT INTO auth.users (id) VALUES (${id}::uuid)`;
    await schema.db.profile.create({ data: { id, role, firstName: "Home fixture", email: `${id}@example.test` } });
    return { userId: id, role, firstName: "Home fixture", email: `${id}@example.test`, emailVerified: true };
  }
  async function job(viewer: Viewer, status: JobStatus = "REVIEW", workerId?: string) {
    return schema.db.job.create({ data: { customerId: viewer.userId, category: "OTHER", title: `Home ${status}`, description: "Customer home test", addressLine1: "1 Example Street", suburb: "Windsor", city: "Invercargill", status, workerId, priceCents: ["REVIEW", "QUOTE_BOUNTY"].includes(status) ? null : 10000 } });
  }
  const load = (viewer: Viewer) => loadCustomerHome(schema.db, viewer, INVERCARGILL_COVERAGE);

  it("owner-scopes every section, returns actual counts beyond the card limit, and omits private pricing", async () => {
    const own = await person(), foreign = await person();
    await Promise.all(Array.from({ length: 5 }, () => job(own, "PRICED")));
    await job(own); await job(own, "QUOTE_BOUNTY"); await job(own, "BOOKABLE");
    await job(own, "CANCELLED"); const foreignJob = await job(foreign, "PRICED");
    const data = (await load(own))!;
    expect(data.counts).toEqual({ needsYou: 5, inProgress: 3 });
    expect(data.needsYou).toHaveLength(3); expect(data.needsYou.every(row => row.action === "price")).toBe(true);
    expect(data.inProgress.every(row => row.action === null)).toBe(true); expect(data.recent).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain(foreignJob.id);
    expect(JSON.stringify(data)).not.toMatch(/customerId|workerId|addressLine|estimate|margin|workerGross|earnCents|variations/);
  });
  it("moves only published extra work into Needs you, and returns it to progress when declined", async () => {
    const customer = await person(), worker = await person("TRADIE"), office = await person("ADMIN");
    const row = await job(customer);
    await priceJob(schema.db, { jobId: row.id, minutes: 60, materialsCents: 0 });
    await schema.db.job.update({ where: { id: row.id }, data: { status: "ASSIGNED", workerId: worker.userId } });
    const variation = await schema.db.variation.create({ data: { jobId: row.id, requestedById: worker.userId, description: "Unpriced customer-private ask", requestedMinutes: 30 } });
    expect((await load(customer))!.counts).toEqual({ needsYou: 0, inProgress: 1 });
    expect(await priceVariation(schema.db, office, variation.id, 0)).toMatchObject({ ok: true });
    expect((await load(customer))!.needsYou).toMatchObject([{ id: row.id, action: "extra-work" }]);
    await schema.db.variation.update({ where: { id: variation.id }, data: { status: "DECLINED" } });
    expect((await load(customer))!.counts).toEqual({ needsYou: 0, inProgress: 1 });
    await schema.db.job.update({ where: { id: row.id }, data: { status: "SUBMITTED" } });
    expect((await load(customer))!.needsYou).toMatchObject([{ id: row.id, action: "sign-off" }]);
  });
  it("uses only the current customer's default saved address and office trade settings", async () => {
    const customer = await person(), foreign = await person();
    await schema.db.address.create({ data: { userId: foreign.userId, isDefault: true, line1: "Foreign address", suburb: "Dunedin", city: "Dunedin", lat: -45.8788, lng: 170.5028 } });
    expect((await load(customer))!.outside).toBe(false);
    const saved = await schema.db.address.create({ data: { userId: customer.userId, isDefault: true, line1: "Private street", suburb: "Dunedin", city: "Dunedin", lat: -45.8788, lng: 170.5028 } });
    expect((await load(customer))!).toMatchObject({ outside: true, location: { label: "Dunedin, Dunedin" } });
    await schema.db.address.update({ where: { id: saved.id }, data: { lat: null, lng: null } });
    expect((await load(customer))!.outside).toBe(false);
    const previous = await schema.db.settings.findUniqueOrThrow({ where: { id: 1 } });
    await schema.db.settings.update({ where: { id: 1 }, data: { enabledTrades: ["OTHER"] } });
    expect((await load(customer))!.categories).toEqual(["other"]);
    await schema.db.settings.update({ where: { id: 1 }, data: { enabledTrades: previous.enabledTrades } });
  });
  it("does not read customer data for workers or office viewers", async () => {
    expect(await load(await person("TRADIE"))).toBeNull();
    expect(await load(await person("ADMIN"))).toBeNull();
  });
});
