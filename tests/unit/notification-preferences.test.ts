import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createPreferenceEditor } from "@/lib/notification-preference-editor";
import { preferenceSnapshot, type PreferenceChange, type PreferenceSaveResult, type PreferenceSource } from "@/lib/notification-preferences";
import { getViewer } from "@/server/auth/viewer";
import { getDb } from "@/server/db";
import { loadPreferencesAction, savePreferenceAction } from "@/server/notifications/preference-actions";
import { loadPreferences, savePreference, type PreferencesDb } from "@/server/notifications/preferences";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

vi.mock("@/server/auth/viewer", () => ({ getViewer: vi.fn(async () => null) }));
vi.mock("@/server/db", () => ({ getDb: vi.fn() }));
const choice: PreferenceChange = { event: "job.priced", channel: "EMAIL", enabled: false };
const fakeDb = () => ({ notificationPreference: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockImplementation(async args => args.select && { event: args.create.event, channel: args.create.channel, enabled: args.create.enabled }) } });

describe("notification preference boundary", () => {
  afterEach(() => { vi.clearAllMocks(); vi.mocked(getViewer).mockResolvedValue(null); });
  it("loads only the checked person's choices and fills a new account's defaults", async () => {
    const db = fakeDb();
    const result = await loadPreferences(db as unknown as PreferencesDb, "mine", "CUSTOMER");
    expect(db.notificationPreference.findMany).toHaveBeenCalledWith({ where: { userId: "mine" }, select: { event: true, channel: true, enabled: true } });
    expect(result.rows).toHaveLength(6);
    expect(result.rows[0].channels.EMAIL).toMatchObject({ enabled: true, locked: false });
    expect(result.rows.find(row => row.event === "job.paid")?.channels.PUSH).toMatchObject({ enabled: false, locked: true });
  });
  it("keeps mandatory options locked even if an old stored preference differs", () => {
    const rows = preferenceSnapshot("CUSTOMER", [{ event: "variation.priced", channel: "EMAIL", enabled: false }]).rows;
    expect(rows.find(row => row.event === "variation.priced")?.channels.EMAIL).toMatchObject({ enabled: true, locked: true, reason: expect.any(String) });
  });
  it.each([
    { ...choice, channel: "SMS" }, { ...choice, channel: "IN_APP" }, { ...choice, event: "unknown.event" },
    { ...choice, userId: "another-person" }, { ...choice, enabled: "false" },
    { ...choice, event: "variation.priced" }, { ...choice, event: "job.paid" }, { ...choice, event: "job.paid", channel: "PUSH", enabled: true },
    { ...choice, event: "payout.paid" },
  ])("rejects unavailable, foreign and locked inputs before any write: %j", async input => {
    const db = fakeDb();
    expect(await savePreference(db as unknown as PreferencesDb, "mine", "CUSTOMER", input)).toMatchObject({ ok: false });
    expect(db.notificationPreference.upsert).not.toHaveBeenCalled();
  });
  it("writes one absolute value under the server's identity, with the same value safe to retry", async () => {
    const db = fakeDb();
    for (let index = 0; index < 2; index++) expect(await savePreference(db as unknown as PreferencesDb, "mine", "CUSTOMER", choice)).toEqual({ ok: true, change: choice });
    expect(db.notificationPreference.upsert).toHaveBeenLastCalledWith({ where: { userId_event_channel: { userId: "mine", event: choice.event, channel: choice.channel } }, create: { userId: "mine", ...choice }, update: { enabled: false }, select: { event: true, channel: true, enabled: true } });
  });
  it("refuses expired sessions and office roles without accessing the database", async () => {
    expect(await loadPreferencesAction()).toMatchObject({ ok: false, error: "session-expired" });
    expect(await savePreferenceAction(choice)).toMatchObject({ ok: false, error: "session-expired" });
    vi.mocked(getViewer).mockResolvedValue({ userId: randomUUID(), role: "ADMIN", email: "office@example.test", firstName: "Office", emailVerified: true });
    expect(await savePreferenceAction(choice)).toMatchObject({ ok: false, error: "forbidden" });
    expect(getDb).not.toHaveBeenCalled();
  });
  it("uses the checked customer for a save and never logs database details on failure", async () => {
    const userId = randomUUID();
    vi.mocked(getViewer).mockResolvedValue({ userId, role: "CUSTOMER", email: "customer@example.test", firstName: "Customer", emailVerified: false });
    const db = fakeDb(); vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
    expect(await savePreferenceAction(choice)).toEqual({ ok: true, change: choice });
    expect(db.notificationPreference.upsert.mock.calls[0][0].create.userId).toBe(userId);
    vi.mocked(getDb).mockImplementationOnce(() => { throw new Error("private-db-secret"); });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadPreferencesAction()).toEqual({ ok: false, error: "unavailable" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-db-secret"); log.mockRestore();
  });
});

describe("immediate saving", () => {
  const value = (editor: ReturnType<typeof createPreferenceEditor>) => editor.getSnapshot().rows[0].channels.EMAIL.enabled;
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  it("serializes and collapses rapid edits; only the latest acknowledgement offers Undo", async () => {
    const responses: Array<(result: PreferenceSaveResult) => void> = [];
    const save = vi.fn<PreferenceSource["save"]>(() => new Promise<PreferenceSaveResult>(resolve => responses.push(resolve)));
    const saved = vi.fn();
    const editor = createPreferenceEditor(preferenceSnapshot("CUSTOMER", []), save, saved);
    editor.change(choice); editor.change({ ...choice, enabled: true }); editor.change(choice); editor.change({ ...choice, enabled: true });
    expect(value(editor)).toBe(true); expect(save).toHaveBeenCalledTimes(1);
    responses.shift()!({ ok: true, change: choice }); await settle();
    expect(value(editor)).toBe(true); expect(saved).not.toHaveBeenCalled(); expect(save).toHaveBeenCalledTimes(2);
    responses.shift()!({ ok: true, change: { ...choice, enabled: true } }); await settle();
    expect(editor.getSnapshot().saving).toBe(false); expect(saved).toHaveBeenLastCalledWith({ ...choice, enabled: true }, false);
  });
  it("rolls back a failed or lost response, retains the latest intention for Retry, then persists Undo", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("lost response")).mockImplementation(async change => ({ ok: true, change }));
    const saved = vi.fn(); const editor = createPreferenceEditor(preferenceSnapshot("CUSTOMER", []), save, saved);
    editor.change(choice); await settle();
    expect(value(editor)).toBe(true); expect(editor.getSnapshot().failure?.change).toEqual(choice); expect(saved).not.toHaveBeenCalled();
    editor.retry(); await settle(); expect(value(editor)).toBe(false); expect(editor.getSnapshot().failure).toBeNull();
    const [change, before] = saved.mock.calls[0]; editor.change({ ...change, enabled: before }); await settle();
    expect(value(editor)).toBe(true); expect(save.mock.calls[2][0]).toEqual({ ...choice, enabled: true });
  });
  it("keeps Undo when the latest rapid toggle already matches the in-flight save", async () => {
    let respond!: (result: PreferenceSaveResult) => void;
    const save = vi.fn<PreferenceSource["save"]>(() => new Promise(resolve => { respond = resolve; }));
    const saved = vi.fn(); const editor = createPreferenceEditor(preferenceSnapshot("CUSTOMER", []), save, saved);
    editor.change(choice); editor.change({ ...choice, enabled: true }); editor.change(choice);
    respond({ ok: true, change: choice }); await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(value(editor)).toBe(false); expect(editor.getSnapshot().saving).toBe(false);
    expect(saved).toHaveBeenCalledExactlyOnceWith(choice, true);
  });
  it("does not write offline, on locked cells, or after unmount", async () => {
    const save = vi.fn(async change => ({ ok: true as const, change }));
    const editor = createPreferenceEditor(preferenceSnapshot("CUSTOMER", []), save, vi.fn());
    editor.setOnline(false); editor.change(choice); editor.setOnline(true);
    editor.change({ ...choice, event: "variation.priced" }); editor.deactivate(); editor.change(choice);
    expect(save).not.toHaveBeenCalled();
  });
});

describe.skipIf(!testDatabaseUrl)("stored preferences (disposable Postgres only)", () => {
  const schema = useTestSchema(import.meta.filename);
  it("persists a choice and Undo without changing another account or duplicating a retried row", async () => {
    const mine = randomUUID(), other = randomUUID();
    for (const id of [mine, other]) {
      await schema.db.$executeRaw`INSERT INTO auth.users(id,email) VALUES(${id}::uuid,${`${id}@example.test`})`;
      await schema.db.profile.create({ data: { id, email: `${id}@example.test`, role: "CUSTOMER", firstName: "Demo" } });
    }
    await savePreference(schema.db, other, "CUSTOMER", { ...choice, enabled: true });
    await savePreference(schema.db, mine, "CUSTOMER", choice); await savePreference(schema.db, mine, "CUSTOMER", choice);
    expect((await loadPreferences(schema.db, mine, "CUSTOMER")).rows[0].channels.EMAIL.enabled).toBe(false);
    expect((await loadPreferences(schema.db, other, "CUSTOMER")).rows[0].channels.EMAIL.enabled).toBe(true);
    expect(await schema.db.notificationPreference.count({ where: { userId: mine } })).toBe(1);
    await savePreference(schema.db, mine, "CUSTOMER", { ...choice, enabled: true });
    expect((await loadPreferences(schema.db, mine, "CUSTOMER")).rows[0].channels.EMAIL.enabled).toBe(true);
  });
});
