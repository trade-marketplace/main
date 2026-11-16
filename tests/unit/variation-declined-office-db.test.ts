import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient, Role } from "@/generated/prisma/client";
import { priceJob } from "@/server/pricing/price-job";
import { requestVariation } from "@/server/variations/request";
import { priceVariation } from "@/server/variations/price";
import { declineVariation } from "@/server/variations/decide";
import { inboxItem, loadInbox } from "@/server/notifications/inbox";
import { notificationId } from "@/server/notifications/notify";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("office notification when extra work is declined", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: Role) {
    const id = randomUUID(); await schema.db.$executeRaw`INSERT INTO auth.users(id) VALUES(${id}::uuid)`;
    await schema.db.profile.create({ data: { id, role, firstName: "Test", email: `${id}@example.test` } }); return { userId: id };
  }
  async function fixture() {
    const customer = await person("CUSTOMER"), worker = await person("TRADIE"), office = await person("ADMIN"); await person("ADMIN");
    const job = await schema.db.job.create({ data: { customerId: customer.userId, title: `Declined extra work ${randomUUID()}`, description: "Fix the door", category: "OTHER", addressLine1: "548 Test Street", suburb: "Windsor", city: "Invercargill" } });
    await priceJob(schema.db, { jobId: job.id, minutes: 60, materialsCents: 0 });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "ASSIGNED", workerId: worker.userId } });
    const requestKey = randomUUID(), path = `variations/${job.id}/${worker.userId}/${randomUUID().replaceAll("-", "")}.webp`;
    await schema.db.variationPhoto.create({ data: { path, jobId: job.id, uploadedById: worker.userId, requestKey, ready: true } });
    const request = await requestVariation(schema.db, worker, { jobId: job.id, requestKey, description: "Fix a second door", hours: 0.5, photoPaths: [path] });
    if (!request.ok) throw Error(request.error);
    const priced = await priceVariation(schema.db, office, request.variationId, 0); if (!priced.ok) throw Error(priced.error);
    return { customer, worker, office, job, id: request.variationId, revision: priced.revision };
  }
  const notices = (id: string) => schema.db.notification.findMany({ where: { type: "variation.declined_office", payload: { path: ["variationId"], equals: id } }, orderBy: { userId: "asc" } });
  const adminIds = async () => (await schema.db.profile.findMany({ where: { role: "ADMIN" }, select: { id: true }, orderBy: { id: "asc" } })).map(row => row.id);

  it("tells the assigned tradie once and every current office user once, with only the planned payload and channel", async () => {
    const f = await fixture(), offices = await adminIds(); await person("TRADIE"); await person("CUSTOMER");
    expect(await declineVariation(schema.db, f.customer, f.id, f.revision)).toEqual({ ok: true, variationId: f.id });
    const rows = await notices(f.id); expect(rows.map(row => row.userId)).toEqual(offices);
    for (const row of rows) {
      expect(row.id).toBe(notificationId(`variation.declined_office:${f.id}:${f.revision}`, row.userId));
      expect(row.payload).toEqual({ jobId: f.job.id, jobNumber: f.job.jobNumber, variationId: f.id });
    }
    expect(NOTIFICATION_EVENTS["variation.declined_office"]).toEqual({ channels: ["IN_APP"], description: "A customer declined extra work." });
    expect(await schema.db.notification.count({ where: { userId: f.worker.userId, type: "variation.declined", payload: { path: ["variationId"], equals: f.id } } })).toBe(1);
    expect(await schema.db.notification.count({ where: { userId: f.worker.userId, type: "variation.declined_office" } })).toBe(0);
    expect(await schema.db.notification.count({ where: { userId: f.customer.userId, type: "variation.declined_office" } })).toBe(0);
    expect(await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).toMatchObject({ status: "ASSIGNED", workerId: f.worker.userId });
  });

  it("replays and concurrent decline calls create no duplicate notice or audit and preserve read state", async () => {
    const f = await fixture();
    expect(await Promise.all([declineVariation(schema.db, f.customer, f.id, f.revision), declineVariation(schema.db, f.customer, f.id, f.revision)])).toEqual([{ ok: true, variationId: f.id }, { ok: true, variationId: f.id }]);
    const before = await notices(f.id), readAt = new Date(); await schema.db.notification.update({ where: { id: before[0].id }, data: { readAt } });
    expect(await declineVariation(schema.db, f.customer, f.id, f.revision)).toEqual({ ok: true, variationId: f.id });
    const after = await notices(f.id); expect(after.map(row => row.id)).toEqual(before.map(row => row.id));
    expect(after.find(row => row.id === before[0].id)?.readAt).toEqual(readAt);
    expect(after.map(row => row.createdAt)).toEqual(before.map(row => row.createdAt));
    expect(await schema.db.auditLog.count({ where: { action: "variation.declined", recordId: f.id } })).toBe(1);
    expect(await schema.db.notification.count({ where: { type: "variation.declined", payload: { path: ["variationId"], equals: f.id } } })).toBe(1);
  });

  it("maps each office inbox item to the admin job page with the planned copy and icon", async () => {
    const f = await fixture(); await declineVariation(schema.db, f.customer, f.id, f.revision);
    for (const row of await notices(f.id)) {
      expect(inboxItem(row)).toMatchObject({ line: "Extra work declined", icon: "block", href: `/admin/jobs/${f.job.id}` });
      expect((await loadInbox(schema.db, row.userId)).items).toContainEqual(expect.objectContaining({ id: row.id, href: `/admin/jobs/${f.job.id}` }));
    }
  });

  it("uses the accepted current price revision, and a stale revision sends nothing", async () => {
    const f = await fixture(); const revised = await priceVariation(schema.db, f.office, f.id, f.revision, 45); expect(revised.ok).toBe(true);
    expect(await declineVariation(schema.db, f.customer, f.id, f.revision)).toMatchObject({ error: "changed" }); expect(await notices(f.id)).toHaveLength(0);
    expect(await declineVariation(schema.db, f.customer, f.id, f.revision + 1)).toMatchObject({ ok: true });
    expect((await notices(f.id)).every(row => row.id === notificationId(`variation.declined_office:${f.id}:${f.revision + 1}`, row.userId))).toBe(true);
  });

  it("does not notify anyone for a foreign customer or tradie decision", async () => {
    const f = await fixture(), stranger = await person("CUSTOMER");
    expect(await declineVariation(schema.db, stranger, f.id, f.revision)).toMatchObject({ error: "not-found" });
    expect(await declineVariation(schema.db, f.worker, f.id, f.revision)).toMatchObject({ error: "forbidden" });
    expect(await notices(f.id)).toHaveLength(0); expect(await schema.db.auditLog.count({ where: { action: "variation.declined", recordId: f.id } })).toBe(0);
  });

  it("rolls back the decline, audit and tradie notice if an office notice cannot be persisted", async () => {
    const f = await fixture(), log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = new Proxy(schema.db, { get(target, prop, receiver) {
      if (prop !== "$transaction") return Reflect.get(target, prop, receiver);
      return (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => target.$transaction(tx => run(new Proxy(tx, { get(inner, key, proxied) {
        if (key !== "notification") return Reflect.get(inner, key, proxied);
        return new Proxy(inner.notification, { get(delegate, method, value) {
          if (method !== "upsert") return Reflect.get(delegate, method, value);
          return (args: Prisma.NotificationUpsertArgs) => { if (args.create.type === "variation.declined_office" && args.create.userId === f.office.userId) throw Error("simulated office insert failure"); return delegate.upsert(args); };
        } });
      } })), options);
    } }) as PrismaClient;
    try { await expect(declineVariation(failing, f.customer, f.id, f.revision)).rejects.toThrow("An in-app notification could not be saved"); } finally { log.mockRestore(); }
    expect(await schema.db.variation.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({ status: "PRICED", revision: f.revision });
    expect(await notices(f.id)).toHaveLength(0); expect(await schema.db.auditLog.count({ where: { action: "variation.declined", recordId: f.id } })).toBe(0);
    expect(await schema.db.notification.count({ where: { type: "variation.declined", payload: { path: ["variationId"], equals: f.id } } })).toBe(0);
    expect(await declineVariation(schema.db, f.customer, f.id, f.revision)).toMatchObject({ ok: true }); expect((await notices(f.id)).length).toBeGreaterThan(0);
  });
});
