import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobStatus, Role } from "@/generated/prisma/client";
import { readOfficePricePreview, publishOfficePrice, requestPricingPhotos } from "@/server/office/pricing-commands";
import { readPricingWorkspace } from "@/server/office/pricing-read";
import { priceJob } from "@/server/pricing/price-job";
import { officeUsers } from "@/server/office/users";
import { getMessages, sendProblemMessage } from "@/server/messages/service";
import { uploadSupportPhoto } from "@/server/messages/photos";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

const FIELDS = { hours: "2", materials: "10.00" };
describe.skipIf(!testDatabaseUrl)("office pricing transactions with real PostgreSQL", () => {
  const schema = useTestSchema(import.meta.filename);
  beforeEach(async () => { await schema.db.settings.update({ where: { id: 1 }, data: { otherRateCents: 3800, sharedRateCents: 7000, holidayPayBps: 800, onCostBps: 1250, marginBps: 2000, gstBps: 1500 } }); });
  async function person(role: Role, firstName: string = role) {
    const userId = randomUUID(), email = `${userId}@example.test`;
    await schema.db.$executeRaw`INSERT INTO auth.users(id,email) VALUES(${userId}::uuid,${email})`;
    await schema.db.profile.create({ data: { id: userId, role, email, firstName, phone: "+64211234567" } });
    return { userId, role };
  }
  async function fixture() {
    const office = await person("ADMIN"), customer = await person("CUSTOMER", "Sarah"), worker = await person("TRADIE", "Jack");
    const job = await schema.db.job.create({ data: { customerId: customer.userId, category: "OTHER", title: "Hang a door", description: "The hinge is loose.", addressLine1: "1 Private Fixture Street", suburb: "Windsor", city: "Invercargill" } });
    return { office, customer, worker, job };
  }
  async function confirmation(f: Awaited<ReturnType<typeof fixture>>, fields = FIELDS) {
    const preview = await readOfficePricePreview(schema.db, f.office, { jobId: f.job.id, ...fields });
    if (!preview.ok) throw new Error(`expected preview: ${preview.error}`);
    return { jobId: f.job.id, ...fields, token: preview.preview.token, requestId: randomUUID() };
  }
  it("previews without writes, then atomically publishes the exact confirmed amount/history/audit and only customer notification", async () => {
    const f = await fixture(), unchanged = await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } });
    const input = await confirmation(f);
    expect(await schema.db.jobPricing.findUnique({ where: { jobId: f.job.id } })).toBeNull();
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).updatedAt).toEqual(unchanged.updatedAt);
    expect(await publishOfficePrice(schema.db, f.office, input)).toEqual({ ok: true });
    const job = await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id }, include: { pricing: true } });
    expect(job).toMatchObject({ status: "PRICED", priceCents: 14123, pricing: { workerRateCents: 3800, minutes: 120, materialsCents: 1000, workerGrossCents: 7600, holidayPayCents: 608, onCostCents: 1026 } });
    expect(await schema.db.jobStatusHistory.count({ where: { jobId: f.job.id, toStatus: "PRICED", changedById: f.office.userId } })).toBe(1);
    expect(await schema.db.auditLog.count({ where: { recordId: f.job.id, action: "job.priced", actorId: f.office.userId } })).toBe(1);
    const notifications = await schema.db.notification.findMany({ where: { userId: f.customer.userId, type: "job.priced" } });
    expect(notifications).toHaveLength(1); expect(JSON.stringify(notifications[0].payload)).not.toMatch(/margin|worker|rate|estimate|hours|materials/);
    expect(await schema.db.notification.count({ where: { userId: f.worker.userId } })).toBe(0);
    expect(await publishOfficePrice(schema.db, f.office, input)).toEqual({ ok: true });
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).updatedAt).toEqual(job.updatedAt);
    expect(await schema.db.auditLog.count({ where: { recordId: f.job.id, action: "job.priced" } })).toBe(1);
    expect(await publishOfficePrice(schema.db, f.office, { ...input, hours: "3" })).toMatchObject({ ok: false, error: "changed" });
  });
  it("rejects changed settings instead of sending a different amount, and needs a fresh confirmation", async () => {
    const f = await fixture(), input = await confirmation(f);
    await schema.db.settings.update({ where: { id: 1 }, data: { otherRateCents: 4200 } });
    const before = await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } });
    expect(await publishOfficePrice(schema.db, f.office, input)).toMatchObject({ ok: false, error: "changed" });
    expect(await schema.db.jobPricing.count({ where: { jobId: f.job.id } })).toBe(0);
    expect(await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).toEqual(before);
    expect(await publishOfficePrice(schema.db, f.office, await confirmation(f))).toEqual({ ok: true });
    expect((await schema.db.jobPricing.findUniqueOrThrow({ where: { jobId: f.job.id } })).workerRateCents).toBe(4200);
  });
  it("keeps a legacy REVIEW draft's saved rates after Settings changes and freezes the confirmed result", async () => {
    const f = await fixture();
    expect(await priceJob(schema.db, { jobId: f.job.id, minutes: 60, materialsCents: 0, pricedById: f.office.userId })).toMatchObject({ ok: true });
    await schema.db.settings.update({ where: { id: 1 }, data: { otherRateCents: 9900 } });
    const input = await confirmation(f);
    expect(await publishOfficePrice(schema.db, f.office, input)).toEqual({ ok: true });
    expect(await schema.db.jobPricing.findUniqueOrThrow({ where: { jobId: f.job.id } })).toMatchObject({ workerRateCents: 3800, minutes: 120, materialsCents: 1000 });
    const data = await readPricingWorkspace(schema.db, f.office, f.job.id);
    expect(data).toMatchObject({ canPrice: false, preview: { total: "$141.23" } });
  });
  it.each(["words", "photos"] as const)("rejects stale confirmation after the customer's %s change", async change => {
    const f = await fixture(), input = await confirmation(f);
    if (change === "words") await schema.db.job.update({ where: { id: f.job.id }, data: { title: "Hang two doors instead" } });
    else await schema.db.jobPhoto.create({ data: { jobId: f.job.id, uploadedById: f.customer.userId, path: `jobs/${f.job.id}/example.webp`, position: 0 } });
    const before = await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } });
    expect(await publishOfficePrice(schema.db, f.office, input)).toMatchObject({ ok: false, error: "changed" });
    expect(await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).toEqual(before);
    expect(await schema.db.jobPricing.count({ where: { jobId: f.job.id } })).toBe(0);
  });
  it.each(["PRICED", "BOOKABLE", "ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW", "CANCELLED"] as JobStatus[])("cannot change or send an already frozen %s job", async status => {
    const f = await fixture(), input = await confirmation(f);
    await priceJob(schema.db, { jobId: f.job.id, minutes: 60, materialsCents: 500, pricedById: f.office.userId });
    await schema.db.job.update({ where: { id: f.job.id }, data: { status, workerId: ["ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW"].includes(status) ? f.worker.userId : null } });
    const before = await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id }, include: { pricing: true } });
    expect(await publishOfficePrice(schema.db, f.office, input)).toMatchObject({ ok: false, error: "frozen" });
    expect(await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id }, include: { pricing: true } })).toEqual(before);
    expect(await requestPricingPhotos(schema.db, f.office, { jobId: f.job.id, requestId: randomUUID(), body: "More photos please." })).toMatchObject({ ok: false, error: "frozen" });
  });
  it("serializes two different office confirmations so one price/audit/notification wins", async () => {
    const f = await fixture(), otherOffice = await person("ADMIN"), input = await confirmation(f);
    const results = await Promise.all([publishOfficePrice(schema.db, f.office, input), publishOfficePrice(schema.db, otherOffice, { ...input, requestId: randomUUID() })]);
    expect(results.filter(row => row.ok)).toHaveLength(1);
    expect(results.filter(row => !row.ok)).toEqual([expect.objectContaining({ error: "frozen" })]);
    expect(await schema.db.jobPricing.count({ where: { jobId: f.job.id } })).toBe(1);
    expect(await schema.db.auditLog.count({ where: { recordId: f.job.id, action: "job.priced" } })).toBe(1);
    expect(await schema.db.notification.count({ where: { userId: f.customer.userId, type: "job.priced" } })).toBe(1);
  });
  it("rolls pricing, status, history and audit back when the transactional customer notification fails", async () => {
    const f = await fixture(), input = await confirmation(f), before = await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } });
    await schema.db.$executeRawUnsafe(`CREATE FUNCTION "${schema.name}".reject_price_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated notification outage'; END; $$`);
    await schema.db.$executeRawUnsafe(`CREATE TRIGGER reject_price_notification BEFORE INSERT ON "${schema.name}".notifications FOR EACH ROW EXECUTE FUNCTION "${schema.name}".reject_price_notification()`);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect(await publishOfficePrice(schema.db, f.office, input)).toMatchObject({ ok: false, error: "unavailable" }); }
    finally { log.mockRestore(); await schema.db.$executeRawUnsafe(`DROP TRIGGER reject_price_notification ON "${schema.name}".notifications`); await schema.db.$executeRawUnsafe(`DROP FUNCTION "${schema.name}".reject_price_notification()`); }
    expect(await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).toEqual(before);
    expect(await schema.db.jobPricing.count({ where: { jobId: f.job.id } })).toBe(0);
    expect(await schema.db.jobStatusHistory.count({ where: { jobId: f.job.id, toStatus: "PRICED" } })).toBe(0);
    expect(await schema.db.auditLog.count({ where: { recordId: f.job.id, action: "job.priced" } })).toBe(0);
  });
  it("opens a readable canonical job conversation, supports customer reply/photo, and never opens legacy/internal history to the current or future worker", async () => {
    const f = await fixture(), foreign = await person("TRADIE", "Foreign");
    const legacy = await schema.db.supportThread.create({ data: { userId: f.customer.userId, jobId: f.job.id, subject: "Legacy private thread" } });
    await schema.db.supportMessage.create({ data: { threadId: legacy.id, authorId: f.office.userId, body: "Legacy private history" } });
    const input = { jobId: f.job.id, requestId: randomUUID(), body: "Please send a close photo of the hinge." };
    expect(await requestPricingPhotos(schema.db, f.office, input)).toEqual({ ok: true });
    expect(await requestPricingPhotos(schema.db, f.office, input)).toEqual({ ok: true });
    const thread = await schema.db.supportThread.findFirstOrThrow({ where: { jobId: f.job.id, jobParticipants: true } });
    expect(thread.id).not.toBe(legacy.id);
    const messages = await schema.db.supportMessage.findMany({ where: { threadId: thread.id } });
    expect(messages).toHaveLength(1); expect(messages[0]).toMatchObject({ body: input.body, fromOffice: true, internal: false, requestKey: input.requestId });
    expect(await schema.db.supportMessage.count({ where: { threadId: legacy.id } })).toBe(1);
    expect(await schema.db.auditLog.count({ where: { recordId: thread.id, action: "support_thread.opened" } })).toBe(1);
    expect(await schema.db.notification.count({ where: { userId: f.customer.userId, type: "message.received" } })).toBe(1);
    expect(await schema.db.notification.count({ where: { userId: f.worker.userId } })).toBe(0);
    await schema.db.supportMessage.create({ data: { threadId: thread.id, authorId: f.office.userId, internal: true, body: "Office-only margin note" } });
    expect((await getMessages(schema.db, f.customer, thread.id)).selected?.messages.map(row => row.body)).toEqual([input.body]);
    const paths = new Set<string>(), store = { put: async (_bucket: string, path: string) => { paths.add(path); }, remove: async () => {}, signedUrl: async () => "https://signed.example.test/photo", exists: async (_bucket: string, path: string) => paths.has(path) };
    const uploaded = await uploadSupportPhoto(schema.db, store, f.customer, f.job.id, await readFile("public/images/examples/switch.jpg"));
    expect(await sendProblemMessage(schema.db, f.customer, thread.id, { requestKey: randomUUID(), text: "Here is the hinge photo.", photoPaths: [uploaded.path] }, { files: store, rateLimit: async () => ({ allowed: true }) })).toMatchObject({ ok: true, threadId: thread.id });
    await schema.db.job.update({ where: { id: f.job.id }, data: { status: "ASSIGNED", workerId: f.worker.userId, priceCents: 12000 } });
    const workerView = await getMessages(schema.db, f.worker, thread.id, async () => "https://signed.example.test/photo");
    expect(workerView.selected?.messages.map(row => row.body)).toEqual([input.body, "Here is the hinge photo."]);
    expect(workerView.selected?.messages[1].photos).toHaveLength(1);
    expect(JSON.stringify(workerView)).not.toMatch(/Office-only|Legacy private|marginCents|workerRate/);
    await expect(getMessages(schema.db, foreign, thread.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(getMessages(schema.db, f.customer, legacy.id)).rejects.toMatchObject({ code: "forbidden" });
    expect(await requestPricingPhotos(schema.db, f.office, { ...input, body: "Changed body" })).toMatchObject({ ok: false, error: "changed" });
  });
  it.each(["demoted", "removed"] as const)("denies a stale ADMIN viewer after its current profile is %s", async kind => {
    const f = await fixture(), input = await confirmation(f), before = await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } });
    if (kind === "demoted") await schema.db.profile.update({ where: { id: f.office.userId }, data: { role: "CUSTOMER" } });
    else await schema.db.profile.delete({ where: { id: f.office.userId } });
    expect(await publishOfficePrice(schema.db, f.office, input)).toMatchObject({ ok: false, error: "forbidden" });
    expect(await requestPricingPhotos(schema.db, f.office, { jobId: f.job.id, requestId: randomUUID(), body: "More photos please." })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).toEqual(before);
    expect(await schema.db.jobPricing.count({ where: { jobId: f.job.id } })).toBe(0);
    expect(await schema.db.supportThread.count({ where: { jobId: f.job.id } })).toBe(0);
  });
  it("rechecks office capability after a job-lock wait and a normal office removal commits", async () => {
    const f = await fixture(), otherOffice = await person("ADMIN"), input = await confirmation(f);
    let release!: () => void, ready!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), locked = new Promise<void>(resolve => { ready = resolve; });
    const blocker = schema.db.$transaction(async tx => { await tx.job.updateMany({ where: { id: f.job.id }, data: { updatedAt: new Date() } }); ready(); await held; });
    await locked;
    const publishing = publishOfficePrice(schema.db, f.office, input);
    try {
      expect(await Promise.race([publishing.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 30))])).toBe(false);
      await officeUsers(schema.db, async () => {}, otherOffice).remove((await schema.db.profile.findUniqueOrThrow({ where: { id: f.office.userId } })).email);
    } finally { release(); await blocker; }
    expect(await publishing).toMatchObject({ ok: false, error: "forbidden" });
    expect(await schema.db.jobPricing.count({ where: { jobId: f.job.id } })).toBe(0);
    expect(await schema.db.notification.count({ where: { userId: f.customer.userId, type: "job.priced" } })).toBe(0);
  });
  it("reads actual estimate history, completed-job counts and public-only ratings through the office DTO", async () => {
    const f = await fixture(), second = await person("TRADIE", "Aroha");
    for (const hidden of [false, true]) {
      const completed = await schema.db.job.create({ data: { customerId: f.customer.userId, workerId: f.worker.userId, category: "OTHER", title: "Completed fixture", description: "Done", addressLine1: "1 Example St", suburb: "Windsor", city: "Invercargill", status: "COMPLETED", priceCents: 10000 } });
      await schema.db.review.create({ data: { jobId: completed.id, reviewerId: f.customer.userId, workerId: f.worker.userId, rating: hidden ? 1 : 5, ...(hidden ? { hiddenAt: new Date(), hiddenById: f.office.userId, hiddenReason: "Fixture hidden review" } : {}) } });
    }
    await schema.db.estimate.create({ data: { jobId: f.job.id, workerId: f.worker.userId, minutes: 90, materialsCents: 500 } });
    await schema.db.estimate.create({ data: { jobId: f.job.id, workerId: second.userId, minutes: 180, materialsCents: 900 } });
    await schema.db.job.update({ where: { id: f.job.id }, data: { description: "Edited job scope" } });
    await schema.db.estimate.update({ where: { jobId_workerId: { jobId: f.job.id, workerId: f.worker.userId } }, data: { minutes: 120 } });
    const data = await readPricingWorkspace(schema.db, f.office, f.job.id);
    expect(data?.estimates).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Jack", record: "5.0 ★ · 2 jobs", stale: false }), expect.objectContaining({ name: "Aroha", stale: true })]));
    expect(data?.estimates).toHaveLength(2); expect(data?.suggestion).toBe("2 h · $5.00");
    expect(JSON.stringify(data)).not.toMatch(/Private Fixture Street|211234567|@example.test|workerRateCents|customerId/);
  });
});
