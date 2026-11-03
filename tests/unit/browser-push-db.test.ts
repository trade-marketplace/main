import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserPushStatus, registerBrowserPush, claimPushDisplay, revokeBrowserPush, pushHash } from "@/server/notifications/browser-push";
import { createPriceReadyPushRule } from "@/server/notifications/price-push";
import { createNotify } from "@/server/notifications/notify";
import type { PushSender } from "@/server/notifications/firebase-provider";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("owned browser push lifecycle", () => {
  const schema = useTestSchema(import.meta.filename); const now = new Date("2026-11-04T00:00:00Z");
  afterEach(async () => { await schema.db.priceReadyPushDelivery.deleteMany(); await schema.db.notification.deleteMany(); await schema.db.browserPushRegistration.deleteMany(); });
  async function customer() {
    const id = randomUUID(), email = `${id}@example.test`;
    await schema.db.$executeRaw`INSERT INTO auth.users(id,email) VALUES(${id}::uuid,${email})`;
    await schema.db.profile.create({ data: { id, email, role: "CUSTOMER", firstName: "Customer", emailVerifiedAt: now } });
    return { userId: id, email, role: "CUSTOMER" as const, firstName: "Customer", emailVerified: true };
  }
  async function priced(person: Awaited<ReturnType<typeof customer>>) {
    return schema.db.job.create({ data: { customerId: person.userId, category: "OTHER", title: "Move the sofa", description: "Move the sofa upstairs", addressLine1: "1 Example Street", suburb: "Gladstone", city: "Invercargill", status: "PRICED", priceCents: 12_000 } });
  }
  async function queued() {
    const person = await customer(), proof = randomBytes(32).toString("hex"), token = `test-device-${randomUUID()}`;
    expect(await registerBrowserPush(schema.db, person, proof, token, now)).toEqual({ status: "enabled" });
    const job = await priced(person);
    const data = { eventId: `priced:${job.id}`, payload: { jobId: job.id, jobNumber: job.jobNumber } };
    const result = await createNotify(schema.db)("job.priced", [person.userId], data);
    const row = await schema.db.priceReadyPushDelivery.findFirstOrThrow({ where: { notificationId: result.notifications[0].id } });
    await schema.db.priceReadyPushDelivery.update({ where: { id: row.id }, data: { createdAt: now, dueAt: now } });
    return { person, proof, token, job, row, notification: result.notifications[0], data };
  }
  const run = (sender: PushSender | null | undefined, at = now) => createPriceReadyPushRule({ sender, wallClock: () => 0 }).run({ db: schema.db, now: at, deadlineAt: new Date(45_000), limit: 10 });

  it("atomically queues only current customer-owned price events with explicit preferences, not replays", async () => {
    const item = await queued(); expect((await schema.db.notification.findUniqueOrThrow({ where: { id: item.notification.id } })).channelsSent).not.toContain("PUSH");
    expect(item.row).toMatchObject({ userId: item.person.userId, jobId: item.job.id, deliveredAt: null, displayedAt: null });
    await createNotify(schema.db)("job.priced", [item.person.userId], item.data); expect(await schema.db.priceReadyPushDelivery.count()).toBe(1);
    await schema.db.priceReadyPushDelivery.deleteMany(); await createNotify(schema.db)("job.priced", [item.person.userId], item.data);
    expect(await schema.db.priceReadyPushDelivery.count()).toBe(0);
    for (const payload of [{}, { jobId: "bad" }, { jobId: randomUUID() }, { jobId: item.job.id }]) {
      const other = await customer(); await registerBrowserPush(schema.db, other, randomBytes(32).toString("hex"), `foreign-device-${randomUUID()}`);
      await createNotify(schema.db)("job.priced", [other.userId], { eventId: randomUUID(), payload });
    }
    expect(await schema.db.priceReadyPushDelivery.count()).toBe(0);
  });
  it("rolls notification and queue back together and never queues an opt-out", async () => {
    const item = await queued(); await schema.db.priceReadyPushDelivery.deleteMany();
    await expect(schema.db.$transaction(async tx => {
      await createNotify(tx, { maxAttempts: 1 })("job.priced", [item.person.userId], { eventId: "rollback", payload: { jobId: item.job.id } }); throw new Error("rollback");
    })).rejects.toThrow("rollback");
    expect(await schema.db.notification.count({ where: { id: { not: item.notification.id } } })).toBe(0);
    expect(await schema.db.priceReadyPushDelivery.count()).toBe(0);
    await schema.db.notificationPreference.update({ where: { userId_event_channel: { userId: item.person.userId, event: "job.priced", channel: "PUSH" } }, data: { enabled: false } });
    await createNotify(schema.db)("job.priced", [item.person.userId], { eventId: "disabled", payload: { jobId: item.job.id } }); expect(await schema.db.priceReadyPushDelivery.count()).toBe(0);
  });
  it("transfers a proven device atomically, refuses another device's token and keeps old queues on their old owner", async () => {
    const item = await queued(), next = await customer();
    expect(await registerBrowserPush(schema.db, next, randomBytes(32).toString("hex"), item.token)).toEqual({ status: "refused" });
    expect(await registerBrowserPush(schema.db, next, item.proof, item.token, now)).toEqual({ status: "enabled" });
    expect(await schema.db.browserPushRegistration.count()).toBe(1);
    expect(await schema.db.browserPushRegistration.findFirst()).toMatchObject({ userId: next.userId, deviceHash: pushHash(item.proof) });
    expect(await schema.db.priceReadyPushDelivery.findUnique({ where: { id: item.row.id } })).toMatchObject({ userId: item.person.userId, failedAt: now });
    expect(await claimPushDisplay(schema.db, item.person, item.proof, item.row.id)).toBeNull(); expect(await claimPushDisplay(schema.db, next, item.proof, item.row.id)).toBeNull();
  });
  it("distinguishes active/revoked/self-opted-out state without revealing or changing another account's mapping", async () => {
    const item = await queued(), other = await customer();
    expect(await browserPushStatus(schema.db, item.person, item.proof)).toBe("active");
    await revokeBrowserPush(schema.db, item.proof, now);
    expect(await browserPushStatus(schema.db, item.person, item.proof)).toBe("revoked");
    expect(await browserPushStatus(schema.db, other, item.proof)).toBe("inactive");
    await registerBrowserPush(schema.db, other, item.proof, item.token, now);
    expect(await browserPushStatus(schema.db, other, item.proof)).toBe("active");
    expect(await browserPushStatus(schema.db, item.person, item.proof)).toBe("inactive");
    await schema.db.notificationPreference.update({ where: { userId_event_channel: { userId: other.userId, event: "job.priced", channel: "PUSH" } }, data: { enabled: false } });
    expect(await browserPushStatus(schema.db, other, item.proof)).toBe("opted-out");
    expect((await schema.db.notificationPreference.findFirstOrThrow({ where: { userId: other.userId, event: "job.priced", channel: "PUSH" } })).enabled).toBe(false);
    await schema.db.notificationPreference.delete({ where: { userId_event_channel: { userId: other.userId, event: "job.priced", channel: "PUSH" } } });
    expect(await browserPushStatus(schema.db, other, item.proof)).toBe("inactive");
    await schema.db.profile.update({ where: { id: other.userId }, data: { emailVerifiedAt: null } });
    expect(await browserPushStatus(schema.db, other, item.proof)).toBe("unavailable");
    expect(await schema.db.browserPushRegistration.findFirstOrThrow()).toMatchObject({ userId: other.userId, revokedAt: null, token: item.token });
  });
  it("gives concurrent foreground/background resolvers exactly one display even before provider acceptance commits", async () => {
    const item = await queued();
    const results = await Promise.all([claimPushDisplay(schema.db, item.person, item.proof, item.row.id, now), claimPushDisplay(schema.db, item.person, item.proof, item.row.id, now)]);
    expect(results.filter(Boolean)).toHaveLength(1); expect(results.find(Boolean)).toMatchObject({ title: "Price ready", href: `/jobs/${item.job.id}` });
    const row = await schema.db.priceReadyPushDelivery.findUniqueOrThrow({ where: { id: item.row.id } }); expect(row.displayedAt).toEqual(now); expect(row.deliveredAt).toBeNull();
    expect(await claimPushDisplay(schema.db, item.person, item.proof, item.row.id)).toBeNull();
  });
  it("rejects foreign sessions, wrong proofs, revoked devices, current opt-outs and no-longer-priced jobs", async () => {
    const item = await queued(), other = await customer();
    expect(await claimPushDisplay(schema.db, other, item.proof, item.row.id)).toBeNull(); expect(await claimPushDisplay(schema.db, item.person, "bad", item.row.id)).toBeNull();
    await revokeBrowserPush(schema.db, item.proof, now); expect(await claimPushDisplay(schema.db, item.person, item.proof, item.row.id)).toBeNull();
    await registerBrowserPush(schema.db, item.person, item.proof, item.token, now);
    await schema.db.notificationPreference.update({ where: { userId_event_channel: { userId: item.person.userId, event: "job.priced", channel: "PUSH" } }, data: { enabled: false } });
    expect(await claimPushDisplay(schema.db, item.person, item.proof, item.row.id)).toBeNull();
    await registerBrowserPush(schema.db, item.person, item.proof, item.token, now);
    await schema.db.job.update({ where: { id: item.job.id }, data: { status: "BOOKABLE" } }); expect(await claimPushDisplay(schema.db, item.person, item.proof, item.row.id)).toBeNull();
  });
  it("commits provider leases before network IO and marks channelsSent only after actual acceptance", async () => {
    const item = await queued();
    const sender = vi.fn(async (token: string, id: string) => {
      expect(token).toBe(item.token); expect(id).toBe(item.row.id);
      await schema.db.$transaction(async tx => { await tx.$queryRawUnsafe(`SELECT id FROM "${schema.name}".price_ready_push_deliveries WHERE id=$1::uuid FOR UPDATE NOWAIT`, id); });
      expect((await schema.db.notification.findUniqueOrThrow({ where: { id: item.notification.id } })).channelsSent).not.toContain("PUSH");
      return { accepted: true };
    });
    expect(await run(sender)).toMatchObject({ done: 1 }); expect(sender).toHaveBeenCalledTimes(1);
    expect((await schema.db.notification.findUniqueOrThrow({ where: { id: item.notification.id } })).channelsSent).toContain("PUSH");
    expect(await schema.db.priceReadyPushDelivery.findUnique({ where: { id: item.row.id } })).toMatchObject({ deliveredAt: now, attempts: 1, leaseToken: null });
  });
  it("retries a lost provider response with the same opaque id without a second display after dismissal", async () => {
    const item = await queued(); const ids: string[] = []; let displays = 0;
    const sender = vi.fn(async (_token: string, id: string) => {
      ids.push(id); if (await claimPushDisplay(schema.db, item.person, item.proof, id, now)) displays++;
      throw new Error("accepted but response lost");
    });
    expect((await run(sender)).failed).toBe(1); expect(displays).toBe(1);
    expect((await run(sender, new Date(now.getTime() + 60_000))).due).toBe(0);
    expect(ids).toEqual([item.row.id]); expect(await claimPushDisplay(schema.db, item.person, item.proof, item.row.id)).toBeNull();
  });
  it("does not consume provider attempts when a slow claim leaves insufficient invocation budget", async () => {
    const item = await queued(); let clock = 0;
    const slow = schema.db.$extends({ query: { priceReadyPushDelivery: { async findUniqueOrThrow({ args, query }) { const row = await query(args); clock = 1_000; return row; } } } });
    const sender = vi.fn(async () => ({ accepted: true }));
    expect(await createPriceReadyPushRule({ sender, wallClock: () => clock }).run({ db: slow as unknown as typeof schema.db, now, limit: 2, deadlineAt: new Date(12_000) })).toMatchObject({ skipped: 1, done: 0 });
    expect(sender).not.toHaveBeenCalled(); expect(await schema.db.priceReadyPushDelivery.findUnique({ where: { id: item.row.id } })).toMatchObject({ attempts: 0, leaseToken: null, deliveredAt: null });
  });
  it("keeps the new tables server-only with RLS enabled and no browser-role grants", async () => {
    const rows = await schema.db.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema.name} AND c.relname IN ('job_post_confirmations','browser_push_registrations','price_ready_push_deliveries')`;
    expect(rows).toHaveLength(3); expect(rows.every(row => row.relrowsecurity)).toBe(true);
    const grants = await schema.db.$queryRaw<unknown[]>`SELECT grantee FROM information_schema.role_table_grants WHERE table_schema=${schema.name} AND table_name IN ('job_post_confirmations','browser_push_registrations','price_ready_push_deliveries') AND grantee IN ('PUBLIC','anon','authenticated')`;
    expect(grants).toEqual([]);
  });
});
