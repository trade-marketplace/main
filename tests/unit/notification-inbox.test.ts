import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { notificationTime } from "@/lib/notifications";
import { getViewer, type Viewer } from "@/server/auth/viewer";
import { getDb } from "@/server/db";
import { loadNotificationsAction, readNotificationsAction } from "@/server/notifications/actions";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import { inboxItem, loadInbox, readInbox } from "@/server/notifications/inbox";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

vi.mock("@/server/auth/viewer", () => ({ getViewer: vi.fn(async () => null) }));
vi.mock("@/server/db", () => ({ getDb: vi.fn() }));

const NOW = new Date("2026-10-28T00:00:00Z");
const row = (changes: Partial<Parameters<typeof inboxItem>[0]> = {}) => ({ id: randomUUID(), type: "job.priced", payload: { jobId: "TM-1005", jobTitle: "Sub wiring" }, createdAt: NOW, readAt: null, ...changes });

describe("inbox presentation boundary", () => {
  it.each([
    ["job.priced", "/jobs/TM-1005", "sell"],
    ["message.received", "/messages/TM-1005", "chat_bubble"],
    ["job.paid", "/receipts/TM-1005", "receipt_long"],
    ["payout.paid", "/earnings", "payments"],
    ["licence.verified", "/profile/trades", "verified"],
  ])("%s links to the relevant destination", (type, href, icon) => {
    expect(inboxItem(row({ type }))).toMatchObject({ href, icon });
  });

  it("never forwards private payload fields or payload URLs to the browser", () => {
    const item = inboxItem(row({ payload: { jobId: "TM-1005", customerPriceCents: 50000, earningsCents: 30000, margin: 20, userId: "private-person", href: "https://example.test/steal", token: "private-token" } }));
    expect(Object.keys(item).sort()).toEqual(["createdAt", "href", "icon", "id", "line", "readAt"]);
    expect(JSON.stringify(item)).not.toMatch(/50000|30000|private|steal|margin/);
    expect(item.href).toBe("/jobs/TM-1005");
  });

  it.each(["//example.test", "../other", "one?owner=other", "one#different", "https://example.test"])("does not turn a malformed job identifier into a destination: %s", (jobId) => {
    const source = row({ payload: { jobId, href: "javascript:alert(1)" } });
    expect(inboxItem(source).href).toBe(`/notifications#${source.id}`);
  });

  it("has short labels for every existing event, and a safe fallback for unknown or malformed payloads", () => {
    for (const type of Object.keys(NOTIFICATION_EVENTS)) {
      const item = inboxItem(row({ type, payload: {} }));
      expect(item.line.split(/\s+/).length).toBeLessThanOrEqual(4);
      expect(item.icon).toMatch(/^[a-z_]+$/);
    }
    expect(inboxItem(row({ type: "unknown.future.event", payload: ["bad"] })).line).toBe("Notification");
    expect(inboxItem(row({ type: "toString", payload: {} })).line).toBe("Notification");
    expect(inboxItem(row({ type: "__proto__", payload: {} })).line).toBe("Notification");
    expect(inboxItem(row({ payload: "bad" })).href).toMatch(/^\/notifications#/);
  });

  it("preserves the full user-written job title and read timestamp", () => {
    const title = "A long job title with <markup> & names that still needs its full accessible name";
    expect(inboxItem(row({ payload: { jobId: "TM-1005", jobTitle: title }, readAt: NOW }))).toMatchObject({ line: `Your price is ready · ${title}`, readAt: NOW.toISOString() });
  });

  it("uses short relative times and New Zealand calendar dates without negative times", () => {
    expect(notificationTime(NOW.toISOString(), NOW.getTime())).toBe("Now");
    expect(notificationTime(NOW.toISOString(), NOW.getTime() + 300_000)).toBe("5 min");
    expect(notificationTime(NOW.toISOString(), NOW.getTime() + 7_200_000)).toBe("2 h");
    expect(notificationTime("2026-10-26T12:00:00Z", NOW.getTime())).toBe("27 Oct");
    expect(notificationTime(NOW.toISOString(), NOW.getTime() - 1000)).toBe("Now");
    expect(notificationTime("invalid", NOW.getTime())).toBe("");
  });
});

describe("authenticated inbox actions", () => {
  afterEach(() => { vi.clearAllMocks(); vi.mocked(getViewer).mockResolvedValue(null); });
  const viewer: Viewer = { userId: randomUUID(), email: "person@example.test", role: "CUSTOMER", firstName: "Test", emailVerified: false };

  it("does not access the database after the session expires or for an office role", async () => {
    expect(await loadNotificationsAction()).toMatchObject({ ok: false, error: "session-expired" });
    expect(await readNotificationsAction(null)).toMatchObject({ ok: false, error: "session-expired" });
    vi.mocked(getViewer).mockResolvedValue({ ...viewer, role: "ADMIN" });
    expect(await loadNotificationsAction()).toEqual({ ok: false, error: "forbidden" });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("allows an unconfirmed customer's own inbox, using the checked viewer id", async () => {
    vi.mocked(getViewer).mockResolvedValue(viewer);
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    vi.mocked(getDb).mockReturnValue({ notification: { findMany, count } } as unknown as ReturnType<typeof getDb>);
    expect(await loadNotificationsAction()).toEqual({ ok: true, inbox: { items: [], unread: 0 } });
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ where: { userId: viewer.userId } });
  });

  it("does not expose database exception details when the inbox is unavailable", async () => {
    vi.mocked(getViewer).mockResolvedValue(viewer);
    vi.mocked(getDb).mockImplementationOnce(() => { throw new Error("private database connection string"); });
    const log = vi.spyOn(console, "error").mockImplementationOnce(() => {});
    expect(await loadNotificationsAction()).toEqual({ ok: false, error: "unavailable" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
    log.mockRestore();
  });
});

describe.skipIf(!testDatabaseUrl)("inbox ownership on disposable local PostgreSQL", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person() {
    const id = randomUUID();
    await schema.db.$executeRawUnsafe("INSERT INTO auth.users (id) VALUES ($1::uuid)", id);
    return schema.db.profile.create({ data: { id, firstName: "Test", email: `${id}@example.test` } });
  }

  it("returns the latest eight owned notifications and the full owned unread count", async () => {
    const alice = await person(); const bob = await person();
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: randomUUID(), userId: alice.id, type: "job.priced", payload: { jobId: `TM-${i}` }, createdAt: new Date(NOW.getTime() - i * 1000) }));
    await schema.db.notification.createMany({ data: [...rows, { id: randomUUID(), userId: bob.id, type: "job.paid", payload: { secret: "other person's data" }, createdAt: NOW }] });
    const result = await loadInbox(schema.db, alice.id);
    expect(result.items.map((r) => r.id)).toEqual(rows.slice(0, 8).map((r) => r.id));
    expect(result.unread).toBe(12);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("cannot mark another person's notification read; owned retries preserve the first read time", async () => {
    const alice = await person(); const bob = await person();
    const own = await schema.db.notification.create({ data: { userId: alice.id, type: "job.priced" } });
    const foreign = await schema.db.notification.create({ data: { userId: bob.id, type: "job.priced" } });
    await readInbox(schema.db, alice.id, foreign.id, NOW);
    expect((await schema.db.notification.findUniqueOrThrow({ where: { id: foreign.id } })).readAt).toBeNull();
    await readInbox(schema.db, alice.id, own.id, NOW);
    await readInbox(schema.db, alice.id, own.id, new Date(NOW.getTime() + 1000));
    expect((await schema.db.notification.findUniqueOrThrow({ where: { id: own.id } })).readAt).toEqual(NOW);
    expect(await schema.db.notification.count({ where: { userId: bob.id, readAt: null } })).toBe(1);
  });

  it("marks all owned rows through the action time without clearing later arrivals or another inbox", async () => {
    const alice = await person(); const bob = await person();
    const future = new Date(NOW.getTime() + 1000);
    const rows = await Promise.all([alice, alice, bob].map((p, i) => schema.db.notification.create({ data: { userId: p.id, type: "job.posted", createdAt: i === 1 ? future : NOW } })));
    const result = await readInbox(schema.db, alice.id, null, NOW);
    expect(result.unread).toBe(1);
    expect((await schema.db.notification.findUniqueOrThrow({ where: { id: rows[0].id } })).readAt).toEqual(NOW);
    expect((await schema.db.notification.findUniqueOrThrow({ where: { id: rows[1].id } })).readAt).toBeNull();
    expect((await schema.db.notification.findUniqueOrThrow({ where: { id: rows[2].id } })).readAt).toBeNull();
    await expect(readInbox(schema.db, alice.id, "not-an-id", NOW)).rejects.toThrow("Invalid notification id");
  });
});
