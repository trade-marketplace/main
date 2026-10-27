import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { Notification, Prisma } from "@/generated/prisma/client";
import { NOTIFICATION_EVENTS, isNotificationEvent } from "@/server/notifications/events";
import {
  type NotificationDb,
  NotificationDeliveryError,
  NotificationInputError,
  createNotify,
  notificationId,
} from "@/server/notifications/notify";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

function fakeDb() {
  const rows = new Map<string, Notification>();
  const preferences = new Map<string, boolean>();
  let failures = 0;
  const upsert = vi.fn(async ({ where, create }: { where: { id: string }; create: Omit<Notification, "createdAt" | "readAt" | "channelsSent"> }) => {
    if (failures-- > 0) throw new Error("sensitive provider response must not be logged");
    const existing = rows.get(where.id);
    if (existing) return existing;
    const row = { ...create, channelsSent: [], readAt: null, createdAt: new Date() } satisfies Notification;
    rows.set(row.id, row);
    return row;
  });
  const update = vi.fn(async ({ where, data }: { where: { id: string }; data: { channelsSent: { push: "EMAIL" | "PUSH" } } }) => {
    const row = rows.get(where.id)!;
    row.channelsSent.push(data.channelsSent.push);
    return row;
  });
  const findUnique = vi.fn(async ({ where }: { where: { userId_channel: { userId: string; channel: string } } }) => {
    const { userId, channel } = where.userId_channel;
    const enabled = preferences.get(`${userId}:${channel}`);
    return enabled === undefined ? null : { userId, channel, enabled, updatedAt: new Date() };
  });
  const db = { notification: { upsert, update }, notificationPreference: { findUnique } } as unknown as NotificationDb;
  return { db, rows, preferences, upsert, update, findUnique, failNext: (times: number) => { failures = times; } };
}

const eventId = "job-command:123";
const userId = randomUUID();
const data = { eventId, payload: { jobId: randomUUID(), jobNumber: 42 } };

describe("notification event catalogue", () => {
  it("lists a default channel for every required event, with in-app as the only launch channel", () => {
    for (const [event, rule] of Object.entries(NOTIFICATION_EVENTS)) {
      expect(event).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/);
      expect(rule.channels).toEqual(["IN_APP"]);
      expect(rule.description.length).toBeGreaterThan(0);
    }
    expect(Object.keys(NOTIFICATION_EVENTS)).toEqual(expect.arrayContaining([
      "job.posted", "job.priced", "job.paid", "job.claimed", "job.window_booked", "job.on_my_way", "job.running_late",
      "variation.requested", "job.submitted", "job.signed_off", "job.auto_completed", "payout.queued", "bounty.available", "crew.invited",
    ]));
    expect(isNotificationEvent("job.priced")).toBe(true);
    expect(isNotificationEvent("toString")).toBe(false);
  });
});

describe("notify (no database or provider calls)", () => {
  it("writes one in-app notification per unique recipient and no optional channels", async () => {
    const fake = fakeDb();
    const result = await createNotify(fake.db)("job.priced", [userId, userId, "another-person"], data);
    expect(result.notifications).toHaveLength(2);
    expect(result.failures).toEqual([]);
    expect(fake.rows.get(notificationId(eventId, userId))).toMatchObject({ userId, type: "job.priced", payload: data.payload, channelsSent: [] });
    expect(fake.findUnique).not.toHaveBeenCalled();
  });

  it("allows recipient-specific private data so the worker never receives customer price", async () => {
    const fake = fakeDb();
    await createNotify(fake.db)("job.priced", [
      { userId: "customer", payload: { customerPriceCents: 11700 } },
      { userId: "worker", payload: { earningsCents: 7000 } },
    ], data);
    const worker = fake.rows.get(notificationId(eventId, "worker"))!;
    expect(worker.payload).toMatchObject({ earningsCents: 7000, jobNumber: 42 });
    expect(worker.payload).not.toHaveProperty("customerPriceCents");
  });

  it("keeps a read row unchanged when an event is replayed, even concurrently", async () => {
    const fake = fakeDb();
    const notify = createNotify(fake.db);
    const first = (await notify("job.priced", [userId], data)).notifications[0];
    first.readAt = new Date();
    await Promise.all(Array.from({ length: 8 }, () => notify("job.priced", [userId], data)));
    expect(fake.rows.size).toBe(1);
    expect(fake.rows.get(first.id)).toBe(first);
    expect(first.readAt).toBeInstanceOf(Date);
    expect(fake.upsert.mock.calls.every(([call]) => (call as unknown as { update: object }).update && Object.keys((call as unknown as { update: object }).update).length === 0)).toBe(true);
  });

  it("has a stable UUID per event/recipient, distinct for another event or recipient", () => {
    expect(notificationId(eventId, userId)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(notificationId(eventId, userId)).toBe(notificationId(eventId, userId));
    expect(notificationId("next", userId)).not.toBe(notificationId(eventId, userId));
    expect(notificationId(eventId, "someone-else")).not.toBe(notificationId(eventId, userId));
  });

  it("retries temporary in-app failures with bounded backoff", async () => {
    const fake = fakeDb(); fake.failNext(2);
    const wait = vi.fn(async () => {}); const logFailure = vi.fn();
    const result = await createNotify(fake.db, { wait, logFailure })("job.posted", [userId], data);
    expect(result.notifications).toHaveLength(1);
    expect(fake.upsert).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[100], [200]]);
    expect(logFailure).not.toHaveBeenCalled();
  });

  it("logs once after exhaustion, excludes sensitive errors, and throws so callers can replay", async () => {
    const fake = fakeDb(); fake.failNext(3);
    const logFailure = vi.fn();
    const notify = createNotify(fake.db, { wait: async () => {}, logFailure });
    await expect(notify("job.posted", [userId], data)).rejects.toBeInstanceOf(NotificationDeliveryError);
    expect(logFailure).toHaveBeenCalledExactlyOnceWith({ event: "job.posted", eventId, userId, channel: "IN_APP", attempts: 3 });
    expect(JSON.stringify(logFailure.mock.calls)).not.toMatch(/sensitive|payload/);
    await notify("job.posted", [userId], data);
    expect(fake.rows.size).toBe(1);
  });

  it("does not lose healthy recipients when one save fails", async () => {
    const fake = fakeDb(); fake.failNext(3);
    const notify = createNotify(fake.db, { wait: async () => {}, logFailure: vi.fn() });
    try {
      await notify("job.posted", ["first", "second"], data);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(NotificationDeliveryError);
      expect((error as NotificationDeliveryError).result.notifications).toHaveLength(1);
    }
    expect(fake.rows.get(notificationId(eventId, "second"))).toBeDefined();
  });

  it("does no work with no recipients and rejects malformed inputs before any write", async () => {
    const fake = fakeDb(); const notify = createNotify(fake.db);
    expect(await notify("job.posted", [], data)).toEqual({ notifications: [], failures: [] });
    await expect(notify("missing" as "job.posted", [userId], data)).rejects.toThrow(NotificationInputError);
    await expect(notify("job.posted", [userId], { eventId: " " })).rejects.toThrow(NotificationInputError);
    await expect(notify("job.posted", [" "], data)).rejects.toThrow(NotificationInputError);
    await expect(notify("job.posted", [{ userId, payload: { a: 1 } }, { userId, payload: { a: 2 } }], data)).rejects.toThrow(NotificationInputError);
    expect(fake.upsert).not.toHaveBeenCalled();
    for (const maxAttempts of [0, 6, 1.5, NaN]) expect(() => createNotify(fake.db, { maxAttempts })).toThrow(NotificationInputError);
  });

  it("rejects reuse of one event id for a different type instead of corrupting the inbox", async () => {
    const fake = fakeDb(); const notify = createNotify(fake.db);
    await notify("job.posted", [userId], data);
    await expect(notify("job.paid", [userId], data)).rejects.toThrow(/reused/);
    expect([...fake.rows.values()][0].type).toBe("job.posted");
  });
});

describe("future optional adapters (all fake, not enabled at launch)", () => {
  function setup() {
    const fake = fakeDb(); const send = vi.fn(async () => {}); const logFailure = vi.fn();
    const notify = createNotify(fake.db, {
      channels: { EMAIL: { send } }, eventChannels: { "job.priced": ["EMAIL"] }, wait: async () => {}, logFailure,
    });
    return { ...fake, send, logFailure, notify };
  }

  it("adds a channel without changing the caller and keeps mandatory in-app", async () => {
    const fake = setup();
    const result = await fake.notify("job.priced", [userId], data);
    expect(result.notifications).toHaveLength(1);
    expect(fake.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ eventId, idempotencyKey: `${notificationId(eventId, userId)}:EMAIL` }));
    expect([...fake.rows.values()][0].channelsSent).toEqual(["EMAIL"]);
    await fake.notify("job.priced", [userId], data);
    expect(fake.send).toHaveBeenCalledTimes(1);
  });

  it("skips a channel the user turned off, while keeping in-app", async () => {
    const fake = setup(); fake.preferences.set(`${userId}:EMAIL`, false);
    await fake.notify("job.priced", [userId], data);
    expect(fake.rows.size).toBe(1);
    expect(fake.send).not.toHaveBeenCalled();
    expect(fake.update).not.toHaveBeenCalled();
  });

  it("retries then logs provider failures, keeps in-app, and resumes on replay", async () => {
    const fake = setup(); fake.send.mockRejectedValueOnce(new Error()).mockRejectedValueOnce(new Error()).mockRejectedValueOnce(new Error());
    const result = await fake.notify("job.priced", [userId], data);
    expect(result.failures).toEqual([{ event: "job.priced", eventId, userId, channel: "EMAIL", attempts: 3 }]);
    expect(fake.rows.size).toBe(1);
    expect([...fake.rows.values()][0].channelsSent).toEqual([]);
    expect(fake.logFailure).toHaveBeenCalledTimes(1);
    await fake.notify("job.priced", [userId], data);
    expect(fake.rows.size).toBe(1);
    expect(fake.send).toHaveBeenCalledTimes(4);
  });

  it("does not send on a preference outage and still retains in-app", async () => {
    const fake = setup(); fake.findUnique.mockRejectedValue(new Error("unavailable"));
    const result = await fake.notify("job.priced", [userId], data);
    expect(result.notifications).toHaveLength(1);
    expect(result.failures).toHaveLength(1);
    expect(fake.findUnique).toHaveBeenCalledTimes(3);
    expect(fake.send).not.toHaveBeenCalled();
  });

  it("a registered adapter alone cannot send an optional channel", async () => {
    const fake = fakeDb(); const send = vi.fn(async () => {});
    await createNotify(fake.db, { channels: { EMAIL: { send } } })("job.priced", [userId], data);
    expect(fake.rows.size).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect(fake.findUnique).not.toHaveBeenCalled();
  });
});

describe("preferences migration (static, never connects to Supabase)", () => {
  it("has a unique user/channel choice with RLS and only an own-row read policy", () => {
    const migration = readFileSync(new URL("../../prisma/migrations/20261028010000_notification_preferences/migration.sql", import.meta.url), "utf8");
    expect(migration).toMatch(/PRIMARY KEY \("user_id", "channel"\)/);
    expect(migration).toMatch(/ON DELETE CASCADE/);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/FOR SELECT[\s\S]*"user_id" = \(SELECT auth.uid\(\)\)/);
    expect(migration).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/);
  });

  it("accepts only catalogue events at compile time", () => {
    const typed = async (db: NotificationDb) => {
      const notify = createNotify(db);
      await notify("job.priced", [userId], data);
      // @ts-expect-error callers cannot invent an event
      await notify("job.something_unknown", [userId], data);
      const payload: Prisma.InputJsonObject = { jobId: "example" };
      return payload;
    };
    expect(typeof typed).toBe("function");
  });
});

describe.skipIf(!testDatabaseUrl)("notifications on throwaway local Postgres", () => {
  const schema = useTestSchema(import.meta.filename);

  async function createPerson() {
    const id = randomUUID();
    await schema.db.$executeRawUnsafe(`INSERT INTO auth.users (id) VALUES ($1::uuid)`, id);
    return schema.db.profile.create({ data: { id, email: `${id}@example.nz`, firstName: "Test" } });
  }

  it("deduplicates concurrent calls in the database and retains a read notification on replay", async () => {
    const person = await createPerson();
    const eventId = randomUUID();
    const payload = { jobNumber: 7 };
    await Promise.all(Array.from({ length: 8 }, () => createNotify(schema.db)("job.posted", [person.id], { eventId, payload })));
    expect(await schema.db.notification.count({ where: { userId: person.id } })).toBe(1);
    const id = notificationId(eventId, person.id);
    const readAt = new Date("2026-10-28T00:00:00Z");
    await schema.db.notification.update({ where: { id }, data: { readAt } });
    // A fresh factory stands in for another request/process; no process-local dedupe cache exists.
    await createNotify(schema.db)("job.posted", [person.id], { eventId, payload: { jobNumber: 999 } });
    expect(await schema.db.notification.findUniqueOrThrow({ where: { id } })).toMatchObject({ readAt, payload });
  });

  it("respects a stored channel opt-out while always saving in-app", async () => {
    const person = await createPerson();
    await schema.db.notificationPreference.create({ data: { userId: person.id, channel: "EMAIL", enabled: false } });
    const send = vi.fn(async () => {});
    const options = { channels: { EMAIL: { send } }, eventChannels: { "job.priced": ["EMAIL"] as const } };
    const eventId = randomUUID();
    await createNotify(schema.db, options)("job.priced", [person.id], { eventId });
    expect(send).not.toHaveBeenCalled();
    expect(await schema.db.notification.count({ where: { userId: person.id } })).toBe(1);
    await schema.db.notificationPreference.update({ where: { userId_channel: { userId: person.id, channel: "EMAIL" } }, data: { enabled: true } });
    await createNotify(schema.db, options)("job.priced", [person.id], { eventId });
    await createNotify(schema.db, options)("job.priced", [person.id], { eventId });
    expect(send).toHaveBeenCalledTimes(1);
    expect((await schema.db.notification.findUniqueOrThrow({ where: { id: notificationId(eventId, person.id) } })).channelsSent).toEqual(["EMAIL"]);
  });

  it("rolls an in-app notification back with the caller's transaction", async () => {
    const person = await createPerson(); const eventId = randomUUID();
    await expect(schema.db.$transaction(async (tx) => {
      await createNotify(tx, { maxAttempts: 1 })("job.posted", [person.id], { eventId });
      throw new Error("the rest of the operation failed");
    })).rejects.toThrow(/rest of the operation/);
    expect(await schema.db.notification.findUnique({ where: { id: notificationId(eventId, person.id) } })).toBeNull();
  });

  it("enforces one preference per user/channel and cascades account deletion", async () => {
    const person = await createPerson();
    await schema.db.notificationPreference.create({ data: { userId: person.id, channel: "PUSH", enabled: false } });
    await expect(schema.db.notificationPreference.create({ data: { userId: person.id, channel: "PUSH", enabled: true } })).rejects.toThrow();
    await schema.db.profile.delete({ where: { id: person.id } });
    expect(await schema.db.notificationPreference.count({ where: { userId: person.id } })).toBe(0);
  });

  it("only lets a Data API user read their own preferences and refuses browser writes", async () => {
    const mine = await createPerson(); const theirs = await createPerson();
    await schema.db.notificationPreference.createMany({ data: [
      { userId: mine.id, channel: "PUSH", enabled: false },
      { userId: theirs.id, channel: "PUSH", enabled: true },
    ] });
    await schema.db.$executeRawUnsafe(`DO $$ BEGIN CREATE ROLE tm_notification_rls_tester NOLOGIN;
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$`);
    await schema.db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema.name}", auth TO tm_notification_rls_tester`);
    await schema.db.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE ON "${schema.name}".notification_preferences TO tm_notification_rls_tester`);
    const asUser = <T>(run: (tx: Prisma.TransactionClient) => Promise<T>, userId: string | null = mine.id) => schema.db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE tm_notification_rls_tester`);
      await tx.$executeRawUnsafe(`SELECT set_config('request.jwt.claims', $1, true)`, JSON.stringify(userId ? { sub: userId } : { role: "anon" }));
      return run(tx);
    });
    const read = (tx: Prisma.TransactionClient) => tx.$queryRawUnsafe<{ user_id: string }[]>(`SELECT user_id FROM "${schema.name}".notification_preferences`);
    expect(await asUser(read)).toEqual([{ user_id: mine.id }]);
    expect(await asUser(read, null)).toEqual([]);
    expect(await asUser((tx) => tx.$queryRawUnsafe(`UPDATE "${schema.name}".notification_preferences SET enabled = true RETURNING user_id`))).toEqual([]);
    await expect(asUser((tx) => tx.$executeRawUnsafe(`INSERT INTO "${schema.name}".notification_preferences (user_id, channel, enabled) VALUES ($1::uuid, 'EMAIL', true)`, mine.id))).rejects.toThrow(/row-level security/);
  });
});
