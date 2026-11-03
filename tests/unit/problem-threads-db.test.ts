import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Role } from "@/generated/prisma/client";
import { getMessages, markThreadRead, openProblemThread, sendProblemMessage, unreadProblemThreadCount } from "@/server/messages/service";
import { problemContactHref } from "@/server/messages/contact";
import { performJobAction } from "@/server/office/job-mutations";
import { uploadSupportPhoto } from "@/server/messages/photos";
import { getOfficeJob } from "@/server/office/job";
import sharp from "sharp";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("shared job problem threads (database)", () => {
  const schema = useTestSchema(import.meta.filename);
  const deps = { rateLimit: async () => ({ allowed: true } as const), notify: async () => {} };
  async function person(role: Role = "CUSTOMER") {
    const id = randomUUID();
    await schema.db.$executeRaw`INSERT INTO auth.users (id) VALUES (${id}::uuid)`;
    await schema.db.profile.create({ data: { id, role, firstName: role === "ADMIN" ? "Office" : role === "TRADIE" ? "Jack" : "Sarah", lastName: "Test", email: `${id}@example.nz` } });
    return { userId: id };
  }
  async function fixture(claimed = true) {
    const customer = await person(); const worker = await person("TRADIE"); const office = await person("ADMIN"); const stranger = await person("TRADIE");
    const job = await schema.db.job.create({ data: { customerId: customer.userId, workerId: claimed ? worker.userId : null, category: "OTHER", title: "Move a sofa", description: "Move a sofa upstairs", addressLine1: "1 Example Street", suburb: "Windsor", city: "Invercargill", status: claimed ? "ASSIGNED" : "REVIEW", priceCents: claimed ? 12000 : null } });
    return { customer, worker, office, stranger, job };
  }
  const input = (jobId: string, text = "I need help with this job.", requestKey = randomUUID()) => ({ jobId, reason: "Job support", text, requestKey, photoPaths: [] });
  const opened = async (f: Awaited<ReturnType<typeof fixture>>) => {
    const r = await openProblemThread(schema.db, f.customer, input(f.job.id), deps);
    expect(r.ok).toBe(true); if (!r.ok) throw new Error(r.error); return r.threadId;
  };
  it("opens one shared thread under concurrent retries, keeps a new request's text, and writes audits", async () => {
    const f = await fixture(); const data = input(f.job.id);
    const [a, b] = await Promise.all([openProblemThread(schema.db, f.customer, data, deps), openProblemThread(schema.db, f.customer, data, deps)]);
    expect(a).toEqual(b); if (!a.ok) throw new Error(a.error);
    expect(await schema.db.supportThread.count({ where: { jobId: f.job.id, jobParticipants: true, status: "OPEN" } })).toBe(1);
    expect(await schema.db.supportMessage.count({ where: { threadId: a.threadId } })).toBe(1);
    const otherRequest = input(f.job.id, "A separate detail that must not be discarded.");
    expect(await openProblemThread(schema.db, f.worker, otherRequest, deps)).toEqual(a);
    expect(await schema.db.supportMessage.findMany({ where: { threadId: a.threadId }, select: { body: true } })).toEqual(expect.arrayContaining([{ body: otherRequest.text }]));
    expect(await schema.db.auditLog.count({ where: { recordId: a.threadId, action: "support_thread.opened" } })).toBe(1);
  });
  it("allows the customer, current assigned worker and office but excludes strangers and former workers", async () => {
    const f = await fixture(); const id = await opened(f);
    expect((await sendProblemMessage(schema.db, f.worker, id, input(f.job.id, "Worker reply"), deps)).ok).toBe(true);
    expect((await sendProblemMessage(schema.db, f.office, id, input(f.job.id, "Office reply"), deps)).ok).toBe(true);
    expect(await sendProblemMessage(schema.db, f.stranger, id, input(f.job.id), deps)).toEqual({ ok: false, error: "forbidden" });
    await expect(getMessages(schema.db, f.stranger, id)).rejects.toMatchObject({ code: "forbidden" });
    await schema.db.job.update({ where: { id: f.job.id }, data: { workerId: f.stranger.userId } });
    expect(await sendProblemMessage(schema.db, f.worker, id, input(f.job.id), deps)).toEqual({ ok: false, error: "forbidden" });
    await expect(getMessages(schema.db, f.worker, id)).rejects.toMatchObject({ code: "forbidden" });
    expect((await getMessages(schema.db, f.stranger, id)).selected?.id).toBe(id);
  });
  it("never exposes legacy private threads or internal office notes to the other participant", async () => {
    const f = await fixture();
    const legacy = await schema.db.supportThread.create({ data: { userId: f.customer.userId, jobId: f.job.id, subject: "Private office history" } });
    await schema.db.supportMessage.create({ data: { threadId: legacy.id, authorId: f.customer.userId, body: "Private customer-only history" } });
    const id = await opened(f);
    await schema.db.supportMessage.create({ data: { threadId: id, authorId: f.office.userId, body: "Office internal secret", internal: true } });
    const result = await getMessages(schema.db, f.worker, id);
    expect(JSON.stringify(result)).not.toMatch(/Private customer-only|Private office|Office internal secret|priceCents/);
    await expect(getMessages(schema.db, f.customer, legacy.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(schema.db.supportThread.update({ where: { id: legacy.id }, data: { jobParticipants: true } })).rejects.toThrow(/legacy support histories/);
  });
  it("redacts contact details in every pre-claim summary/message and reveals them after claim", async () => {
    const f = await fixture(false); const text = "Email sarah@example.nz or call +64 21 123 4567 / 021-765-4321";
    const result = await openProblemThread(schema.db, f.customer, { ...input(f.job.id, text), reason: "Contact sarah@example.nz" }, deps);
    if (!result.ok) throw new Error(result.error);
    const before = await getMessages(schema.db, f.customer, result.threadId);
    expect(JSON.stringify(before)).not.toMatch(/sarah@example|123 4567|765-4321/);
    expect(before.selected?.messages[0].body).toContain("hidden until the job is booked");
    await schema.db.job.update({ where: { id: f.job.id }, data: { workerId: f.worker.userId, status: "ASSIGNED", priceCents: 12000 } });
    expect((await getMessages(schema.db, f.worker, result.threadId)).selected?.messages[0].body).toBe(text);
  });
  it("checks photo ownership and existence before saving; only authorized readers receive signed URLs", async () => {
    const f = await fixture(); const id = await opened(f); const path = `support/${f.job.id}/${f.worker.userId}/${"a".repeat(32)}.webp`;
    const data = { ...input(f.job.id, "Here is the photo."), photoPaths: [path] };
    expect(await sendProblemMessage(schema.db, f.customer, id, data, { ...deps, files: { exists: async () => true } })).toEqual({ ok: false, error: "photos-pending" });
    expect(await sendProblemMessage(schema.db, f.worker, id, data, { ...deps, files: { exists: async () => false } })).toEqual({ ok: false, error: "photos-pending" });
    expect((await sendProblemMessage(schema.db, f.worker, id, data, { ...deps, files: { exists: async () => true } })).ok).toBe(true);
    const sign = vi.fn(async () => "https://files.example/signed");
    await expect(getMessages(schema.db, f.stranger, id, sign)).rejects.toMatchObject({ code: "forbidden" }); expect(sign).not.toHaveBeenCalled();
    const view = await getMessages(schema.db, f.customer, id, sign);
    expect(view.selected?.messages.at(-1)?.photos).toEqual([expect.objectContaining({ url: "https://files.example/signed" })]);
    const officeView = await getOfficeJob(schema.db, f.job.id, new Date(), sign);
    expect(officeView?.messages.at(-1)?.photos).toEqual([expect.objectContaining({ url: "https://files.example/signed" })]);
  });
  it("preserves text on validation/rate-limit/closed-thread errors and deduplicates send retries", async () => {
    const f = await fixture(); const id = await opened(f); const data = input(f.job.id, "Once only.");
    await Promise.all([sendProblemMessage(schema.db, f.worker, id, data, deps), sendProblemMessage(schema.db, f.worker, id, data, deps)]);
    expect(await schema.db.supportMessage.count({ where: { requestKey: data.requestKey } })).toBe(1);
    expect(await sendProblemMessage(schema.db, f.worker, id, { ...data, text: "Changed text with the old key" }, deps)).toEqual({ ok: false, error: "invalid" });
    const path = `support/${f.job.id}/${f.worker.userId}/${"b".repeat(32)}.webp`;
    expect(await sendProblemMessage(schema.db, f.worker, id, { ...data, photoPaths: [path] }, { ...deps, files: { exists: async () => true } })).toEqual({ ok: false, error: "invalid" });
    expect(await schema.db.supportMessage.count({ where: { requestKey: data.requestKey } })).toBe(1);
    expect(await sendProblemMessage(schema.db, f.worker, id, { ...data, text: "" }, deps)).toEqual({ ok: false, error: "invalid" });
    expect(await sendProblemMessage(schema.db, f.worker, id, data, { ...deps, rateLimit: async () => ({ allowed: false, retryAfter: 30 }) })).toEqual({ ok: false, error: "try-later", retryAfter: 30 });
    await schema.db.supportThread.update({ where: { id }, data: { status: "CLOSED" } });
    expect(await sendProblemMessage(schema.db, f.worker, id, data, deps)).toEqual({ ok: false, error: "closed" });
  });
  it("records read receipts only for an authorized public message and uses the same office thread", async () => {
    const f = await fixture(); const id = await opened(f);
    const result = await performJobAction(schema.db, f.office, { action: "message", jobId: f.job.id, body: "Trade Marketplace office reply" });
    expect(result).toEqual({ ok: true });
    expect(await schema.db.supportThread.count({ where: { jobId: f.job.id } })).toBe(1);
    const view = await getMessages(schema.db, f.customer, id);
    expect(view.selected?.messages.at(-1)?.author).toBe("Trade Marketplace");
    expect(await schema.db.notification.count({ where: { userId: f.customer.userId, type: "message.received", payload: { path: ["threadId"], equals: id } } })).toBe(1);
    const first = view.selected!.messages[0];
    await expect(markThreadRead(schema.db, f.stranger, id, first.id)).rejects.toMatchObject({ code: "forbidden" });
    await markThreadRead(schema.db, f.worker, id, first.id);
    expect((await getMessages(schema.db, f.customer, id)).selected?.messages[0].seen).toBe(true);
  });
  it("notifies other participants with route IDs only, and notification failure never loses a message", async () => {
    const f = await fixture(); const result = await openProblemThread(schema.db, f.customer, input(f.job.id), { rateLimit: deps.rateLimit });
    if (!result.ok) throw new Error(result.error);
    const rows = await schema.db.notification.findMany({ where: { type: "message.received", payload: { path: ["threadId"], equals: result.threadId } } });
    expect(rows.map(row => row.userId)).toEqual(expect.arrayContaining([f.worker.userId, f.office.userId]));
    for (const row of rows) expect(JSON.stringify(row.payload)).not.toMatch(/body|email|price|address/);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect((await sendProblemMessage(schema.db, f.worker, result.threadId, input(f.job.id), { ...deps, notify: async () => { throw new Error("offline"); } })).ok).toBe(true); }
    finally { log.mockRestore(); }
  });
  it("Contact targets an owned thread/job, and cannot disclose a foreign destination", async () => {
    const f = await fixture();
    expect(await problemContactHref(schema.db, f.customer, f.job.id)).toBe(`/messages?job=${f.job.id}`);
    const id = await opened(f);
    expect(await problemContactHref(schema.db, f.worker, f.job.id)).toBe(`/messages/${id}`);
    expect(await problemContactHref(schema.db, f.stranger, f.job.id)).toBe("/messages");
  });
  it("uses the existing private photo processor and refuses unrelated uploaders before Storage", async () => {
    const f = await fixture(); const put = vi.fn(async () => {});
    const files = { put, signedUrl: async () => "", remove: async () => {} };
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().withMetadata().toBuffer();
    await expect(uploadSupportPhoto(schema.db, files, f.stranger, f.job.id, bytes)).rejects.toMatchObject({ code: "forbidden" });
    expect(put).not.toHaveBeenCalled();
    const result = await uploadSupportPhoto(schema.db, files, f.worker, f.job.id, bytes);
    expect(result.path).toMatch(new RegExp(`^support/${f.job.id}/${f.worker.userId}/[a-f0-9]{32}\\.webp$`));
    expect(put).toHaveBeenCalledWith("photos", result.path, expect.any(Buffer), "image/webp");
    await expect(uploadSupportPhoto(schema.db, files, f.worker, f.job.id, new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ code: "wrong-type" });
  });
  it("enforces current participant authors at the database boundary and keeps new tables server-only", async () => {
    const f = await fixture(); const id = await opened(f);
    await expect(schema.db.supportMessage.create({ data: { threadId: id, authorId: f.stranger.userId, body: "Unauthorized" } })).rejects.toThrow(/current participant/);
    await schema.db.supportMessage.create({ data: { threadId: id, authorId: f.worker.userId, body: "Allowed worker" } });
    await schema.db.job.update({ where: { id: f.job.id }, data: { workerId: f.stranger.userId } });
    await expect(schema.db.supportMessage.create({ data: { threadId: id, authorId: f.worker.userId, body: "Former worker" } })).rejects.toThrow(/current participant/);
    const tables = await schema.db.$queryRaw<{ relname: string; relrowsecurity: boolean; publicPrivileges: boolean }[]>`
      SELECT c.relname, c.relrowsecurity, EXISTS(SELECT FROM aclexplode(c.relacl) a WHERE a.grantee=0) AS "publicPrivileges"
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=${schema.name} AND c.relname IN ('support_threads','support_messages','support_message_photos','support_thread_reads')`;
    expect(tables).toHaveLength(4);
    for (const table of tables) { expect(table.relrowsecurity).toBe(true); expect(table.publicPrivileges).toBe(false); }
  });
  it("counts unread shared replies only for current participants and ignores private history and internal notes", async () => {
    const f = await fixture(); const id = await opened(f);
    const first = (await getMessages(schema.db, f.worker, id)).selected!.messages[0];
    expect(await unreadProblemThreadCount(schema.db, f.worker.userId)).toBe(1);
    expect(await unreadProblemThreadCount(schema.db, f.customer.userId)).toBe(0);
    expect(await unreadProblemThreadCount(schema.db, f.stranger.userId)).toBe(0);
    await markThreadRead(schema.db, f.worker, id, first.id);
    const legacy = await schema.db.supportThread.create({ data: { userId: f.worker.userId, jobId: f.job.id, subject: "Private" } });
    await schema.db.supportMessage.create({ data: { threadId: legacy.id, authorId: f.office.userId, body: "Private reply" } });
    await schema.db.supportMessage.create({ data: { threadId: id, authorId: f.office.userId, body: "Internal note", internal: true } });
    expect(await unreadProblemThreadCount(schema.db, f.worker.userId)).toBe(0);
    await sendProblemMessage(schema.db, f.office, id, input(f.job.id, "Public office reply"), deps);
    expect(await unreadProblemThreadCount(schema.db, f.worker.userId)).toBe(1);
    expect(await unreadProblemThreadCount(schema.db, f.customer.userId)).toBe(1);
    await schema.db.job.update({ where: { id: f.job.id }, data: { workerId: f.stranger.userId } });
    expect(await unreadProblemThreadCount(schema.db, f.worker.userId)).toBe(0);
    expect(await unreadProblemThreadCount(schema.db, f.stranger.userId)).toBe(1);
  });
  it("keeps a worker-initiated shared thread with the customer when the worker changes", async () => {
    const f = await fixture(); const result = await openProblemThread(schema.db, f.worker, input(f.job.id), deps);
    if (!result.ok) throw new Error(result.error);
    expect(await schema.db.supportThread.findUnique({ where: { id: result.threadId }, select: { userId: true } })).toEqual({ userId: f.customer.userId });
  });
  it("deletes shared threads with their job while preserving legacy private history", async () => {
    const f = await fixture(); const id = await opened(f);
    const legacy = await schema.db.supportThread.create({ data: { userId: f.customer.userId, jobId: f.job.id, subject: "Private history" } });
    await schema.db.job.delete({ where: { id: f.job.id } });
    expect(await schema.db.supportThread.findUnique({ where: { id } })).toBeNull();
    expect(await schema.db.supportThread.findUnique({ where: { id: legacy.id }, select: { jobId: true } })).toEqual({ jobId: null });
  });
});
