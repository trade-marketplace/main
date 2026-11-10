import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Role } from "@/generated/prisma/client";
import { parseOfficeSupportQuery } from "@/lib/office-support";
import { getOfficeSupport, listOfficeSupport } from "@/server/office/support";
import { getSupportThread, sendSupportMessage } from "@/server/messages/support";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("office support inbox with PostgreSQL", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: Role, firstName = role as string) {
    const userId = randomUUID(), email = `${userId}@example.test`;
    await schema.db.$executeRaw`INSERT INTO auth.users(id,email) VALUES(${userId}::uuid,${email})`;
    await schema.db.profile.create({ data: { id: userId, role, email, firstName, lastName: "Fixture" } });
    return { userId, email };
  }
  async function fixture() {
    const office = await person("ADMIN"), customer = await person("CUSTOMER", "Sarah"), worker = await person("TRADIE");
    const job = await schema.db.job.create({ data: { customerId: customer.userId, workerId: worker.userId, category: "OTHER", title: "Inbox door repair", description: "Fix the latch", addressLine1: "1 Private Street", suburb: "Windsor", city: "Invercargill", status: "ASSIGNED", priceCents: 12000 } });
    const privateThread = await schema.db.supportThread.create({ data: { userId: customer.userId, jobId: job.id, subject: `Private support ${randomUUID()}` } });
    const sharedThread = await schema.db.supportThread.create({ data: { userId: customer.userId, jobId: job.id, jobParticipants: true, subject: `Shared job support ${randomUUID()}` } });
    await schema.db.supportMessage.create({ data: { threadId: privateThread.id, authorId: customer.userId, body: "Please help with my account." } });
    return { office, customer, worker, job, privateThread, sharedThread };
  }
  it("routes shared job messages to the established office job page and keeps job-linked private reports on the private path", async () => {
    const f = await fixture();
    expect(await getOfficeSupport(schema.db, f.office, f.sharedThread.id)).toEqual({ kind: "job", jobId: f.job.id });
    const detail = await getOfficeSupport(schema.db, f.office, f.privateThread.id);
    expect(detail).toMatchObject({ kind: "support", viewerId: f.office.userId, conversation: { id: f.privateThread.id, messages: [{ body: "Please help with my account." }] } });
    await expect(getSupportThread(schema.db, f.worker, f.privateThread.id)).rejects.toMatchObject({ code: "forbidden" });
    expect(await getOfficeSupport(schema.db, f.office, randomUUID())).toBeNull();
  });
  it("denies ordinary roles and an office user whose database role was revoked before reading or signing", async () => {
    const f = await fixture(), sign = vi.fn(async () => "https://files.example/signed");
    for (const actor of [f.customer, f.worker]) {
      await expect(listOfficeSupport(schema.db, actor, parseOfficeSupportQuery({}))).rejects.toMatchObject({ code: "forbidden" });
      await expect(getOfficeSupport(schema.db, actor, f.privateThread.id, undefined, sign)).rejects.toMatchObject({ code: "forbidden" });
    }
    await schema.db.profile.update({ where: { id: f.office.userId }, data: { role: "CUSTOMER" } });
    await expect(getOfficeSupport(schema.db, f.office, f.privateThread.id, undefined, sign)).rejects.toMatchObject({ code: "forbidden" });
    expect(sign).not.toHaveBeenCalled();
  });
  it("excludes internal notes from list previews, unread indicators and the conversation, then shows the same reply to its owner", async () => {
    const f = await fixture();
    await schema.db.supportMessage.create({ data: { threadId: f.privateThread.id, authorId: f.office.userId, internal: true, body: "INTERNAL_CANARY_183" } });
    const query = parseOfficeSupportQuery({ q: f.privateThread.subject });
    const list = await listOfficeSupport(schema.db, f.office, query);
    expect(list.rows).toHaveLength(1); expect(list.rows[0]).toMatchObject({ preview: "Please help with my account.", unread: true, kind: "support" });
    const detail = await getOfficeSupport(schema.db, f.office, f.privateThread.id);
    expect(JSON.stringify(detail)).not.toContain("INTERNAL_CANARY_183");
    expect(JSON.stringify(detail)).not.toMatch(/priceCents|marginCents|Private Street/);
    const reply = await sendSupportMessage(schema.db, f.office, f.privateThread.id, { text: "Office reply to the account owner.", requestKey: randomUUID(), photoPaths: [] }, { rateLimit: async () => ({ allowed: true }), notify: async () => {} });
    expect(reply.ok).toBe(true);
    const owner = await getSupportThread(schema.db, f.customer, f.privateThread.id);
    expect(owner.messages.at(-1)).toMatchObject({ body: "Office reply to the account owner.", office: true });
    expect(JSON.stringify(owner)).not.toContain("INTERNAL_CANARY_183");
  });
  it("paginates a bounded office list, clamps stale pages and searches owner email/job number with status filtering", async () => {
    const f = await fixture(), label = `page183-${randomUUID()}`;
    await schema.db.supportThread.createMany({ data: Array.from({ length: 27 }, (_, index) => ({ userId: f.customer.userId, subject: `${label} ${index}`, status: "OPEN" as const })) });
    const page1 = await listOfficeSupport(schema.db, f.office, parseOfficeSupportQuery({ q: label }));
    const page2 = await listOfficeSupport(schema.db, f.office, parseOfficeSupportQuery({ q: label, page: "2" }));
    expect(page1).toMatchObject({ total: 27, page: 1 }); expect(page1.rows).toHaveLength(25); expect(page2.rows).toHaveLength(2);
    expect(new Set([...page1.rows, ...page2.rows].map(row => row.id)).size).toBe(27);
    expect((await listOfficeSupport(schema.db, f.office, parseOfficeSupportQuery({ q: label, page: "9999" }))).page).toBe(2);
    await schema.db.supportThread.update({ where: { id: f.privateThread.id }, data: { status: "CLOSED", closedAt: new Date() } });
    expect((await listOfficeSupport(schema.db, f.office, parseOfficeSupportQuery({ q: f.customer.email, status: "closed" }))).rows.map(row => row.id)).toEqual([f.privateThread.id]);
    const jobs = await listOfficeSupport(schema.db, f.office, parseOfficeSupportQuery({ q: `TM-${f.job.jobNumber}`, status: "all" }));
    expect(jobs.rows.map(row => row.id).sort()).toEqual([f.privateThread.id, f.sharedThread.id].sort());
  });
});
