import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { JobStatus, Role } from "@/generated/prisma/client";
import { listCustomerJobs } from "@/server/customer-jobs";
import { priceJob } from "@/server/pricing/price-job";
import { priceVariation } from "@/server/variations/price";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("customer list with real PostgreSQL rows", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: Role = "CUSTOMER") {
    const userId = randomUUID(); await schema.db.$executeRaw`INSERT INTO auth.users(id) VALUES (${userId}::uuid)`;
    await schema.db.profile.create({ data: { id: userId, role, firstName: "Alex", lastName: "Worker", email: `${userId}@example.test` } });
    return { userId, role };
  }
  async function job(customerId: string, status: JobStatus = "REVIEW", title = "Leaking tap", workerId?: string, createdAt = new Date()) {
    return schema.db.job.create({ data: { customerId, status, category: "OTHER", title, description: "Private test job", addressLine1: "Private street", suburb: "Windsor", city: "Invercargill", workerId, priceCents: ["REVIEW", "QUOTE_BOUNTY"].includes(status) ? null : 10000, createdAt } });
  }
  it("scopes search and all tab counts to the owner, and never serializes private pricing", async () => {
    const own = await person(), foreign = await person();
    const first = await job(own.userId); await job(own.userId, "COMPLETED", "Done tap", (await person("TRADIE")).userId);
    await job(own.userId, "CANCELLED", "Cancelled tap"); const secret = await job(foreign.userId, "PRICED", "Foreign secret tap");
    const data = await listCustomerJobs(schema.db, own, { tab: "active", q: "TAP", page: 1 });
    expect(data.counts).toEqual({ active: 1, done: 1, cancelled: 1 }); expect(data.rows).toHaveLength(1); expect(data.rows[0].id).toBe(first.id);
    const number = await listCustomerJobs(schema.db, own, { tab: "active", q: `TM-${first.jobNumber}`, page: 1 });
    expect(number.rows.map(row => row.id)).toEqual([first.id]);
    expect(JSON.stringify(data)).not.toContain(secret.id); expect(JSON.stringify(data)).not.toMatch(/customerId|workerId|addressLine|estimate|margin|workerGross|earnCents|variations/);
    await expect(listCustomerJobs(schema.db, await person("TRADIE"), { tab: "active", q: "", page: 1 })).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });
  it("pages across the needs-action boundary without losing or repeating jobs, newest within each group", async () => {
    const own = await person();
    const priority = [];
    for (let i = 0; i < 22; i++) priority.push(await job(own.userId, "PRICED", `Priority ${i}`, undefined, new Date(Date.UTC(2026, 10, 1, i))));
    const ordinary = await job(own.userId, "REVIEW", "Newest ordinary", undefined, new Date("2026-11-04T00:00:00Z"));
    const first = await listCustomerJobs(schema.db, own, { tab: "active", q: "", page: 1 });
    const second = await listCustomerJobs(schema.db, own, { tab: "active", q: "", page: 2 });
    expect(first.rows).toHaveLength(20); expect(first.rows[0].id).toBe(priority[21].id);
    expect(second.rows.map(row => row.id)).toEqual([priority[1].id, priority[0].id, ordinary.id]);
    expect(new Set([...first.rows, ...second.rows].map(row => row.id)).size).toBe(23);
    expect((await listCustomerJobs(schema.db, own, { tab: "active", q: "", page: 999999 })).page).toBe(2);
  });
  it("prioritizes priced extra work and sign-off, while unpriced worker requests stay ordinary", async () => {
    const own = await person(), worker = await person("TRADIE"), office = await person("ADMIN");
    const assigned = await job(own.userId);
    await priceJob(schema.db, { jobId: assigned.id, minutes: 60, materialsCents: 0 });
    await schema.db.job.update({ where: { id: assigned.id }, data: { status: "ASSIGNED", workerId: worker.userId } });
    const ask = await schema.db.variation.create({ data: { jobId: assigned.id, requestedById: worker.userId, description: "Private worker request", requestedMinutes: 30 } });
    expect((await listCustomerJobs(schema.db, own, { tab: "active", q: "", page: 1 })).rows[0].action).toBeNull();
    expect(await priceVariation(schema.db, office, ask.id, 0)).toMatchObject({ ok: true });
    const priced = await listCustomerJobs(schema.db, own, { tab: "active", q: "", page: 1 });
    expect(priced.rows[0].action).toBe("extra-work");
    expect(priced.rows[0].tradie).toBe("Alex W.");
    expect(priced.rows[0].worker).toEqual({ firstName: "Alex", lastInitial: "W" });
    await schema.db.variation.update({ where: { id: ask.id }, data: { status: "DECLINED" } });
    await schema.db.job.update({ where: { id: assigned.id }, data: { status: "SUBMITTED" } });
    expect((await listCustomerJobs(schema.db, own, { tab: "active", q: "", page: 1 })).rows[0].action).toBe("sign-off");
  });
});
