import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { notificationDays, notificationsHref, notificationsQuery, type InboxItem } from "@/lib/notifications";
import { getViewer, type Viewer } from "@/server/auth/viewer";
import { getDb } from "@/server/db";
import { loadNotificationsPageAction, readNotificationsPageAction } from "@/server/notifications/actions";
import { loadNotificationsPage, markInboxRead } from "@/server/notifications/inbox";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

vi.mock("@/server/auth/viewer", () => ({ getViewer: vi.fn(async () => null) }));
vi.mock("@/server/db", () => ({ getDb: vi.fn() }));
const NOW = new Date("2026-10-30T00:00:00Z");

describe("notifications list URL and calendar", () => {
  it("normalizes hostile query inputs and bounds pagination", () => {
    for (const input of [null, [], "unread", { page: -1 }, { page: "NaN" }, { page: 1.5 }, { page: [] }]) expect(notificationsQuery(input)).toEqual({ page: 1, filter: "all" });
    expect(notificationsQuery({ page: "2", filter: "unread", userId: "foreign" })).toEqual({ page: 2, filter: "unread" });
    expect(notificationsQuery({ page: 9_999_999 })).toEqual({ page: 1_000_000, filter: "all" });
    expect(notificationsQuery({ filter: ["unread"] })).toEqual({ page: 1, filter: "all" });
  });
  it("keeps filter and page in URLs, resetting pages when All is selected", () => {
    expect(notificationsHref({ page: 2, filter: "unread" })).toBe("/notifications?filter=unread&page=2");
    expect(notificationsHref({ page: 1, filter: "all" })).toBe("/notifications");
    expect(notificationsHref({ page: 1, filter: "unread" }, "/dev/components/notifications-page", "mode=trade&page=9")).toBe("/dev/components/notifications-page?mode=trade&filter=unread");
  });
  it("groups by Auckland midnight rather than elapsed 24-hour windows, including DST", () => {
    const items = ["2026-09-27T10:59:00Z", "2026-09-27T11:01:00Z", "2026-09-27T10:30:00Z"].map((createdAt, i) => ({ id: String(i), createdAt } as InboxItem));
    const groups = notificationDays(items, Date.parse("2026-09-27T11:10:00Z"));
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([["27 September 2026", ["0", "2"]], ["Today", ["1"]]]);
  });
});

describe("full inbox action boundaries", () => {
  const viewer: Viewer = { userId: randomUUID(), email: "person@example.test", role: "TRADIE", firstName: "Test", emailVerified: false };
  afterEach(() => { vi.clearAllMocks(); vi.mocked(getViewer).mockResolvedValue(null); });

  it("authenticates every load/read invocation and never queries for signed-out or office users", async () => {
    for (const role of [null, "ADMIN"] as const) {
      vi.mocked(getViewer).mockResolvedValue(role ? { ...viewer, role } : null);
      expect(await loadNotificationsPageAction({})).toMatchObject({ ok: false, error: role ? "forbidden" : "session-expired" });
      expect(await readNotificationsPageAction(null, {})).toMatchObject({ ok: false, error: role ? "forbidden" : "session-expired" });
    }
    expect(getDb).not.toHaveBeenCalled();
  });
  it.each(["CUSTOMER", "TRADIE"] as const)("uses the checked %s id for full-page reads and read writes", async (role) => {
    vi.mocked(getViewer).mockResolvedValue({ ...viewer, role });
    const findMany = vi.fn().mockResolvedValue([]); const count = vi.fn().mockResolvedValue(0); const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    vi.mocked(getDb).mockReturnValue({ notification: { findMany, count, updateMany } } as unknown as ReturnType<typeof getDb>);
    const query = { filter: "unread", page: 2, userId: "foreign" };
    expect(await loadNotificationsPageAction(query)).toEqual({ ok: true, inbox: { items: [], page: 1, total: 0, unread: 0 } });
    expect(await readNotificationsPageAction(null, query)).toMatchObject({ ok: true });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: viewer.userId, readAt: null }, take: 25, skip: 0 }));
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: viewer.userId, readAt: null }) }));
    vi.mocked(getViewer).mockResolvedValue(null);
    expect(await readNotificationsPageAction(null, query)).toMatchObject({ error: "session-expired" });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
  it("does not expose connection details on a failed load or write", async () => {
    vi.mocked(getViewer).mockResolvedValue(viewer);
    vi.mocked(getDb).mockImplementation(() => { throw new Error("private connection string"); });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadNotificationsPageAction({})).toEqual({ ok: false, error: "unavailable" });
    expect(await readNotificationsPageAction(null, {})).toEqual({ ok: false, error: "unavailable" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private"); log.mockRestore();
  });
});

describe.skipIf(!testDatabaseUrl)("full list on disposable PostgreSQL", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person() {
    const id = randomUUID(); await schema.db.$executeRawUnsafe("INSERT INTO auth.users (id) VALUES ($1::uuid)", id);
    return schema.db.profile.create({ data: { id, firstName: "Test", email: `${id}@example.test` } });
  }
  it("reaches every owned row beyond eight, stably paginates timestamp ties, and excludes foreign data", async () => {
    const alice = await person(); const bob = await person();
    const rows = Array.from({ length: 31 }, (_, i) => ({ id: randomUUID(), userId: alice.id, type: "job.priced", payload: { jobId: `TM-${i}`, token: "private" }, createdAt: NOW, readAt: i % 3 === 0 ? NOW : null }));
    await schema.db.notification.createMany({ data: [...rows, { userId: bob.id, type: "job.posted", payload: { secret: "foreign" }, createdAt: NOW }] });
    const expected = rows.map((r) => r.id).sort().reverse();
    const first = await loadNotificationsPage(schema.db, alice.id, { page: 1 });
    const second = await loadNotificationsPage(schema.db, alice.id, { page: 2 });
    expect(first).toMatchObject({ page: 1, total: 31, unread: 20 });
    expect(first.items).toHaveLength(25); expect(second.items).toHaveLength(6);
    expect([...first.items, ...second.items].map((r) => r.id)).toEqual(expected);
    expect(JSON.stringify([first, second])).not.toMatch(/private|foreign|userId|token/);
    const unread = await loadNotificationsPage(schema.db, alice.id, { filter: "unread", page: 99 });
    expect(unread).toMatchObject({ total: 20, unread: 20, page: 1 });
    expect(unread.items.every((r) => r.readAt === null)).toBe(true);
    expect((await loadNotificationsPage(schema.db, alice.id, { page: 999 })).page).toBe(2);
  });
  it("keeps read writes owned, idempotent, and bounded before later arrivals", async () => {
    const alice = await person(); const bob = await person();
    const own = await schema.db.notification.create({ data: { userId: alice.id, type: "job.posted", createdAt: NOW } });
    const foreign = await schema.db.notification.create({ data: { userId: bob.id, type: "job.posted", createdAt: NOW } });
    const later = await schema.db.notification.create({ data: { userId: alice.id, type: "job.posted", createdAt: new Date(NOW.getTime() + 1000) } });
    await markInboxRead(schema.db, alice.id, foreign.id, NOW);
    expect((await schema.db.notification.findUniqueOrThrow({ where: { id: foreign.id } })).readAt).toBeNull();
    await markInboxRead(schema.db, alice.id, own.id, NOW);
    await markInboxRead(schema.db, alice.id, own.id, new Date(NOW.getTime() + 500));
    expect((await schema.db.notification.findUniqueOrThrow({ where: { id: own.id } })).readAt).toEqual(NOW);
    await markInboxRead(schema.db, alice.id, null, NOW);
    expect((await schema.db.notification.findUniqueOrThrow({ where: { id: later.id } })).readAt).toBeNull();
    await expect(markInboxRead(schema.db, alice.id, "bad", NOW)).rejects.toThrow("Invalid notification id");
    await markInboxRead(schema.db, alice.id, null, new Date(NOW.getTime() + 2000));
    expect(await loadNotificationsPage(schema.db, alice.id, { filter: "unread" })).toEqual({ items: [], total: 0, unread: 0, page: 1 });
  });
});
