import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/generated/prisma/client";
import { getSupportInbox, getSupportThread, markSupportThreadRead, openSupportThread, sendSupportMessage } from "@/server/messages/support";
import { getMessages, sendProblemMessage } from "@/server/messages/service";
import { inboxItem } from "@/server/notifications/inbox";
import { officeUsers } from "@/server/office/users";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("private office support (database)", () => {
  const schema = useTestSchema(import.meta.filename);
  const deps = { rateLimit: async () => ({ allowed: true } as const) };
  afterEach(async () => { await schema.db.profile.updateMany({ where: { role: "ADMIN" }, data: { role: "CUSTOMER" } }); });
  async function person(role: Role = "CUSTOMER") {
    const id = randomUUID();
    await schema.db.$executeRaw`INSERT INTO auth.users(id) VALUES (${id}::uuid)`;
    await schema.db.profile.create({ data: { id, role, firstName: role === "ADMIN" ? "Office" : "Sarah", lastName: "Person", email: `${id}@example.nz` } });
    return { userId: id };
  }
  const input = (text = "Can you help me?", requestKey = randomUUID()) => ({ subject: "Account help", text, requestKey });
  async function fixture() {
    const owner = await person(), office = await person("ADMIN"), stranger = await person("TRADIE");
    const data = input(); const opened = await openSupportThread(schema.db, owner, data, deps);
    if (!opened.ok) throw new Error(opened.error);
    return { owner, office, stranger, id: opened.threadId, data };
  }
  it("opens once under concurrent retries, derives ownership, and delivers role-specific links atomically", async () => {
    const owner = await person("TRADIE"), office = await person("ADMIN"), data = input();
    const results = await Promise.all([openSupportThread(schema.db, owner, data, deps), openSupportThread(schema.db, owner, data, deps)]);
    expect(results[0]).toEqual(results[1]); const opened = results[0]; if (!opened.ok) throw new Error(opened.error);
    const thread = await schema.db.supportThread.findUniqueOrThrow({ where: { id: opened.threadId } });
    expect(thread).toMatchObject({ userId: owner.userId, jobId: null, problemReportId: null, jobParticipants: false });
    expect(await schema.db.supportMessage.count({ where: { threadId: thread.id } })).toBe(1);
    expect(await schema.db.auditLog.count({ where: { recordId: thread.id } })).toBe(2);
    const notice = await schema.db.notification.findFirstOrThrow({ where: { userId: office.userId, type: "message.received" } });
    expect(inboxItem(notice).href).toBe(`/admin/support/${thread.id}`);
    expect(JSON.stringify(notice.payload)).not.toContain(data.text);
    expect(await openSupportThread(schema.db, owner, { ...data, subject: "Changed" }, deps)).toEqual({ ok: false, error: "invalid" });
    expect(await sendSupportMessage(schema.db, office, thread.id, { text: "We can help.", requestKey: randomUUID() }, deps)).toEqual(opened);
    const reply = await schema.db.notification.findFirstOrThrow({ where: { userId: owner.userId, type: "message.received" } });
    expect(inboxItem(reply).href).toBe(`/support/${thread.id}`);
    expect((await getSupportThread(schema.db, owner, thread.id)).messages.at(-1)).toMatchObject({ office: true, author: "Trade Marketplace", body: "We can help." });
  });
  it("returns an authorized exact office receipt before consuming another allowance, while new/changed/unauthorized sends still fail", async () => {
    const f = await fixture(), data = { text: "Last allowance reply", requestKey: randomUUID() };
    const rateLimit = vi.fn().mockResolvedValueOnce({ allowed: true }).mockResolvedValue({ allowed: false, retryAfter: 600 });
    const saved = await sendSupportMessage(schema.db, f.office, f.id, data, { rateLimit });
    expect(saved.ok).toBe(true);
    await schema.db.supportThread.update({ where: { id: f.id }, data: { status: "CLOSED" } });
    expect(await sendSupportMessage(schema.db, f.office, f.id, data, { rateLimit })).toEqual(saved);
    expect(rateLimit).toHaveBeenCalledTimes(1);
    expect(await sendSupportMessage(schema.db, f.office, f.id, { ...data, text: "Changed retry" }, { rateLimit })).toEqual({ ok: false, error: "invalid" });
    expect(await sendSupportMessage(schema.db, f.stranger, f.id, data, { rateLimit })).toEqual({ ok: false, error: "forbidden" });
    expect(rateLimit).toHaveBeenCalledTimes(1);
    await schema.db.supportThread.update({ where: { id: f.id }, data: { status: "OPEN" } });
    expect(await sendSupportMessage(schema.db, f.office, f.id, { ...data, requestKey: randomUUID() }, { rateLimit })).toEqual({ ok: false, error: "try-later", retryAfter: 600 });
    expect(await schema.db.supportMessage.count({ where: { requestKey: data.requestKey } })).toBe(1);
    expect(await schema.db.notification.count({ where: { userId: f.owner.userId, type: "message.received" } })).toBe(1);
  });
  it("returns an exact opening receipt before rate enforcement without creating another thread", async () => {
    const f = await fixture(), data = input("Opening at the last allowance");
    const rateLimit = vi.fn().mockResolvedValueOnce({ allowed: true }).mockResolvedValue({ allowed: false, retryAfter: 600 });
    const saved = await openSupportThread(schema.db, f.owner, data, { rateLimit });
    expect(saved.ok).toBe(true); expect(await openSupportThread(schema.db, f.owner, data, { rateLimit })).toEqual(saved);
    expect(rateLimit).toHaveBeenCalledTimes(1);
    expect(await openSupportThread(schema.db, f.owner, { ...data, text: "Changed" }, { rateLimit })).toEqual({ ok: false, error: "invalid" });
    expect(await openSupportThread(schema.db, f.owner, { ...data, requestKey: randomUUID() }, { rateLimit })).toEqual({ ok: false, error: "try-later", retryAfter: 600 });
    expect(await schema.db.supportMessage.count({ where: { requestKey: data.requestKey } })).toBe(1);
  });
  it.each(["opening", "office reply"] as const)("returns the in-flight %s receipt when a concurrent duplicate exhausts the allowance", async kind => {
    const f = await fixture(), data = input("Concurrent final allowance");
    let entered!: () => void, release!: () => void;
    const held = new Promise<void>(resolve => { entered = resolve; }), proceed = new Promise<void>(resolve => { release = resolve; });
    const rateLimit = vi.fn().mockResolvedValueOnce({ allowed: true }).mockResolvedValue({ allowed: false, retryAfter: 600 });
    const invoke = (overrides: Parameters<typeof sendSupportMessage>[4]) => kind === "opening"
      ? openSupportThread(schema.db, f.owner, data, overrides)
      : sendSupportMessage(schema.db, f.office, f.id, { text: data.text, requestKey: data.requestKey }, overrides);
    const first = invoke({ rateLimit, notify: async () => { entered(); await proceed; } });
    await held;
    const retry = invoke({ rateLimit });
    try { await vi.waitFor(() => expect(rateLimit).toHaveBeenCalledTimes(2)); }
    finally { release(); }
    const saved = await first; expect(saved.ok).toBe(true); expect(await retry).toEqual(saved);
    expect(await schema.db.supportMessage.count({ where: { requestKey: data.requestKey } })).toBe(1);
  });
  it("holds the canonical office capability until its reply commits, then denies the revoked role including a saved replay", async () => {
    const f = await fixture(), otherOffice = await person("ADMIN"), profile = await schema.db.profile.findUniqueOrThrow({ where: { id: f.office.userId } });
    const data = { text: "Reply before office removal", requestKey: randomUUID() };
    let entered!: () => void, release!: () => void, pid = 0;
    const held = new Promise<void>(resolve => { entered = resolve; }), proceed = new Promise<void>(resolve => { release = resolve; });
    const sending = sendSupportMessage(schema.db, f.office, f.id, data, { ...deps, notify: async tx => { [ { pid } ] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`; entered(); await proceed; } });
    await held;
    const removing = officeUsers(schema.db, async () => {}, { userId: otherOffice.userId }).remove(profile.email);
    try {
      await vi.waitFor(async () => { const [row] = await schema.db.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))`; expect(row.count).toBe(1); });
    } finally { release(); }
    expect((await sending).ok).toBe(true); await removing;
    expect(await sendSupportMessage(schema.db, f.office, f.id, data, deps)).toEqual({ ok: false, error: "forbidden" });
    expect(await sendSupportMessage(schema.db, f.office, f.id, { ...data, requestKey: randomUUID() }, deps)).toEqual({ ok: false, error: "forbidden" });
    expect(await schema.db.supportMessage.count({ where: { requestKey: data.requestKey } })).toBe(1);
  });
  it("rejects injected job/owner/internal/photo fields and keeps private histories out of the job API", async () => {
    const f = await fixture();
    for (const injected of [{ jobId: randomUUID() }, { userId: f.stranger.userId }, { internal: true }, { photoPaths: ["secret"] }]) {
      expect(await openSupportThread(schema.db, f.owner, { ...input(), ...injected }, deps)).toEqual({ ok: false, error: "invalid" });
    }
    expect(await openSupportThread(schema.db, f.office, input(), deps)).toEqual({ ok: false, error: "forbidden" });
    await expect(getMessages(schema.db, f.owner, f.id)).rejects.toMatchObject({ code: "forbidden" });
    expect(await sendProblemMessage(schema.db, f.owner, f.id, { text: "Private", requestKey: randomUUID() }, deps)).toEqual({ ok: false, error: "forbidden" });
    const sign = vi.fn(async () => "signed");
    await expect(getSupportThread(schema.db, f.stranger, f.id, sign)).rejects.toMatchObject({ code: "forbidden" });
    expect(sign).not.toHaveBeenCalled();
    expect(await sendSupportMessage(schema.db, f.stranger, f.id, { text: "No", requestKey: randomUUID() }, deps)).toEqual({ ok: false, error: "forbidden" });
    await schema.db.profile.update({ where: { id: f.office.userId }, data: { role: "TRADIE" } });
    await expect(getSupportThread(schema.db, f.office, f.id)).rejects.toMatchObject({ code: "forbidden" });
  });
  it("keeps a job-linked private report owner/office only, and excludes all internal note metadata", async () => {
    const f = await fixture();
    const job = await schema.db.job.create({ data: { customerId: f.owner.userId, workerId: f.stranger.userId, category: "OTHER", title: "Private job title", description: "Move a sofa", addressLine1: "Secret address", suburb: "Windsor", city: "Invercargill", status: "ASSIGNED", priceCents: 12000 } });
    await schema.db.supportThread.update({ where: { id: f.id }, data: { jobId: job.id } });
    await schema.db.supportMessage.create({ data: { threadId: f.id, authorId: f.office.userId, body: "Office secret", internal: true, photos: { create: { path: "internal/photo" } } } });
    const sign = vi.fn(async () => "signed");
    const view = await getSupportThread(schema.db, f.owner, f.id, sign);
    expect(JSON.stringify(view)).not.toMatch(/Office secret|Private job|Secret address|12000|internal\/photo/);
    expect(sign).not.toHaveBeenCalled();
    expect((await getSupportInbox(schema.db, f.owner)).threads[0].unread).toBe(false);
    await expect(getSupportThread(schema.db, f.stranger, f.id)).rejects.toMatchObject({ code: "forbidden" });
    const shared = await schema.db.supportThread.create({ data: { userId: f.owner.userId, jobId: job.id, subject: "Job support", jobParticipants: true } });
    await expect(getSupportThread(schema.db, f.owner, shared.id)).rejects.toMatchObject({ code: "forbidden" });
  });
  it("paginates public history without signing hidden photos; old receipts never acknowledge newer replies", async () => {
    const f = await fixture(), base = Date.now() + 1000;
    const history = Array.from({ length: 55 }, (_, i) => ({ id: randomUUID(), threadId: f.id, authorId: f.office.userId, body: `Reply ${i}`, createdAt: new Date(base + i * 1000) }));
    await schema.db.supportMessage.createMany({ data: history });
    const note = await schema.db.supportMessage.create({ data: { threadId: f.id, authorId: f.office.userId, body: "Secret", internal: true } });
    const last = await getSupportThread(schema.db, f.owner, f.id);
    expect(last.messages).toHaveLength(50); expect(last.latestMessageId).toBe(history[54].id);
    const first = await getSupportThread(schema.db, f.owner, f.id, undefined, last.olderCursor!);
    expect(new Set([...last.messages, ...first.messages].map(m => m.id)).size).toBe(56);
    await expect(getSupportThread(schema.db, f.owner, f.id, undefined, note.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(markSupportThreadRead(schema.db, f.owner, f.id, note.id)).rejects.toMatchObject({ code: "forbidden" });
    await markSupportThreadRead(schema.db, f.owner, f.id, history[0].id);
    expect((await getSupportInbox(schema.db, f.owner)).threads[0].unread).toBe(true);
    await Promise.all([markSupportThreadRead(schema.db, f.owner, f.id, history[54].id), markSupportThreadRead(schema.db, f.owner, f.id, history[1].id)]);
    expect((await getSupportInbox(schema.db, f.owner)).threads[0].unread).toBe(false);
  });
  it("keeps sends retryable on notification failure and permits only exact committed retries after closure", async () => {
    const f = await fixture(); const data = { text: "A complete retryable draft", requestKey: randomUUID() };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect(await sendSupportMessage(schema.db, f.owner, f.id, data, { ...deps, notify: async () => { throw new Error("Unavailable"); } })).toEqual({ ok: false, error: "unavailable" }); } finally { log.mockRestore(); }
    expect(await schema.db.supportMessage.count({ where: { requestKey: data.requestKey } })).toBe(0);
    expect((await sendSupportMessage(schema.db, f.owner, f.id, data, deps)).ok).toBe(true);
    await schema.db.supportThread.update({ where: { id: f.id }, data: { status: "CLOSED" } });
    expect((await sendSupportMessage(schema.db, f.owner, f.id, data, deps)).ok).toBe(true);
    expect(await sendSupportMessage(schema.db, f.owner, f.id, { ...data, requestKey: randomUUID() }, deps)).toEqual({ ok: false, error: "closed" });
    expect((await getSupportThread(schema.db, f.owner, f.id)).closed).toBe(true);
  });
});
