import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Role, PrismaClient } from "@/generated/prisma/client";
import type { Viewer } from "@/server/auth/viewer";
import { loadCustomerExtras } from "@/server/jobs/customer-extras";
import { priceJob } from "@/server/pricing/price-job";
import { requestVariation } from "@/server/variations/request";
import { priceVariation } from "@/server/variations/price";
import { declineVariationAction } from "@/server/variations/actions";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

const context = vi.hoisted(() => ({ db: null as PrismaClient | null, viewer: null as Viewer | null }));
vi.mock("@/server/db", () => ({ getDb: () => context.db }));
vi.mock("@/server/auth/viewer", () => ({ getViewer: async () => context.viewer }));

describe.skipIf(!testDatabaseUrl)("customer extra work ownership and existing decline action", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: Role) {
    const id = randomUUID(); await schema.db.$executeRaw`INSERT INTO auth.users (id) VALUES (${id}::uuid)`;
    await schema.db.profile.create({ data: { id, role, email: `${id}@example.test`, firstName: "Test" } });
    return { userId: id, role };
  }
  async function fixture() {
    const customer = await person("CUSTOMER"), worker = await person("TRADIE"), office = await person("ADMIN");
    const job = await schema.db.job.create({ data: { customerId: customer.userId, title: "Extra work", description: "Replace a switch", category: "ELECTRICAL", addressLine1: "1 Example St", suburb: "Windsor", city: "Invercargill" } });
    await priceJob(schema.db, { jobId: job.id, minutes: 120, materialsCents: 0 });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "ASSIGNED", workerId: worker.userId } });
    const key = randomUUID(), path = `variations/${job.id}/${worker.userId}/${randomUUID().replaceAll("-", "")}.webp`;
    await schema.db.variationPhoto.create({ data: { path, jobId: job.id, uploadedById: worker.userId, requestKey: key, ready: true } });
    const request = await requestVariation(schema.db, worker, { jobId: job.id, requestKey: key, description: "Replace a second cracked switch", hours: 0.5, photoPaths: [path] });
    if (!request.ok) throw new Error(request.error);
    await priceVariation(schema.db, office, request.variationId, 0);
    return { customer, worker, office, job, id: request.variationId };
  }
  it("gives only the owning current customer the bounded safe payload", async () => {
    const { customer, worker, office, job, id } = await fixture();
    const rows = await loadCustomerExtras(schema.db, customer, job.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, revision: 1, status: "PRICED", photoCount: 1 });
    expect(Object.keys(rows[0]).sort()).toEqual(["id", "revision", "status", "description", "priceCents", "photoCount", "pricedAt", "decidedAt"].sort());
    for (const viewer of [null, worker, office, await person("CUSTOMER")]) expect(await loadCustomerExtras(schema.db, viewer, job.id)).toEqual([]);
    await schema.db.profile.update({ where: { id: customer.userId }, data: { role: "TRADIE" } });
    expect(await loadCustomerExtras(schema.db, customer, job.id)).toEqual([]);
  });
  it("declines through the real protected action, once, and tells the assigned tradie", async () => {
    const { customer, worker, job, id } = await fixture();
    context.db = schema.db;
    context.viewer = null;
    expect(await declineVariationAction(id, 1)).toMatchObject({ error: "session-expired" });
    context.viewer = { ...customer, email: "customer@example.test", firstName: "Test", emailVerified: true };
    expect(await declineVariationAction(id, 0)).toMatchObject({ error: "changed" });
    expect(await declineVariationAction(id, 1)).toMatchObject({ ok: true });
    expect(await declineVariationAction(id, 1)).toMatchObject({ ok: true });
    expect(await schema.db.variation.findUnique({ where: { id } })).toMatchObject({ status: "DECLINED" });
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "ASSIGNED" });
    expect(await schema.db.notification.count({ where: { userId: worker.userId, type: "variation.declined", payload: { path: ["variationId"], equals: id } } })).toBe(1);
    expect(await schema.db.auditLog.count({ where: { action: "variation.declined", recordId: id } })).toBe(1);
  });
});
