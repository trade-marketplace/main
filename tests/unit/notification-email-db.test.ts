import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/generated/prisma/client";
import { money } from "@/lib/office-job";
import { saveTrade } from "@/server/account/trades";
import { notificationId } from "@/server/notifications/notify";
import { createNotify } from "@/server/notifications/notify";
import { createNotificationEmailRule } from "@/server/notifications/email-rule";
import type { ContactMailer } from "@/server/contact";
import { transitionJob } from "@/server/jobs/status-machine";
import { decideTradie, licenceReviewVersion } from "@/server/office/tradie-commands";
import { publishOfficePrice, readOfficePricePreview } from "@/server/office/pricing-commands";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("notification email delivery in PostgreSQL", () => {
  const schema = useTestSchema(import.meta.filename);
  const now = new Date();
  beforeEach(async () => { await schema.db.notification.deleteMany(); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  const run = (mailer: ContactMailer | null, at = new Date()) => createNotificationEmailRule({ mailer }).run({ db: schema.db, now: at, limit: 5 });
  const mailer = () => vi.fn<ContactMailer>(async () => true);

  async function person(role: Role, firstName = "Jack") {
    const userId = randomUUID();
    await schema.db.$executeRaw`INSERT INTO auth.users(id) VALUES(${userId}::uuid)`;
    await schema.db.profile.create({ data: { id: userId, role, firstName, email: `${userId}@example.test`, emailVerifiedAt: now } });
    return { userId };
  }

  async function approvedLicence(resubmission = false) {
    const worker = await person("TRADIE"), office = await person("ADMIN", "Matt");
    const input = { trade: "ELECTRICAL", number: "E 220981", expiresOn: `${now.getUTCFullYear() + 2}-03-31` };
    const document = (letter: string) => `licences/${worker.userId}/${letter.repeat(32)}.webp`;
    expect(await saveTrade(schema.db, worker.userId, input, async () => document("a"))).toMatchObject({ ok: true });
    if (resubmission) {
      const pending = await schema.db.licence.findUniqueOrThrow({ where: { userId_trade: { userId: worker.userId, trade: "ELECTRICAL" } } });
      expect(await decideTradie(schema.db, office, { kind: "reject", userId: worker.userId, trade: "ELECTRICAL", version: licenceReviewVersion(pending), reason: "Upload the current card.", note: "Checked the register" })).toEqual({ ok: true });
      expect(await saveTrade(schema.db, worker.userId, input, async () => document("b"))).toMatchObject({ ok: true });
    }
    const pending = await schema.db.licence.findUniqueOrThrow({ where: { userId_trade: { userId: worker.userId, trade: "ELECTRICAL" } } });
    const version = licenceReviewVersion(pending);
    expect(await decideTradie(schema.db, office, { kind: "approve", userId: worker.userId, trade: "ELECTRICAL", version, note: "Checked the current official register" })).toEqual({ ok: true });
    const licence = await schema.db.licence.findUniqueOrThrow({ where: { id: pending.id } });
    const notice = await schema.db.notification.findFirstOrThrow({ where: { userId: worker.userId, type: "licence.verified" } });
    return { worker, office, licence, notice, version };
  }

  async function jobNotice(event: "job.priced" | "job.submitted" = "job.priced") {
    const customer = await person("CUSTOMER", "Sarah"), worker = await person("TRADIE");
    const job = await schema.db.job.create({ data: {
      customerId: customer.userId, workerId: event === "job.submitted" ? worker.userId : null,
      category: "ELECTRICAL", title: "Sub wiring", description: "Replace the old wiring.", addressLine1: "1 Example Street",
      suburb: "Windsor", city: "Invercargill", status: event === "job.submitted" ? "SUBMITTED" : "PRICED", priceCents: 37200,
    } });
    const result = await createNotify(schema.db)(event, [customer.userId], { eventId: event === "job.priced" ? `job.price:${job.id}:${randomUUID()}` : `job.submitted:${job.id}:${randomUUID()}`, payload: { jobId: job.id, jobNumber: job.jobNumber } });
    return { customer, worker, job, notice: result.notifications[0] };
  }

  it("sends all three real event shapes once, marks EMAIL, and sends nothing on a second run", async () => {
    const priced = await jobNotice(), submitted = await jobNotice("job.submitted"), licence = await approvedLicence();
    const send = mailer();
    expect(await run(send)).toMatchObject({ due: 3, done: 3, skipped: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.map(([message]) => message.subject)).toEqual([
      "Your price is ready · Sub wiring · $372.00",
      "Jack’s finished. All good? · Please check within 48 hours",
      "Your licence is checked · Electrical · you can claim jobs now",
    ]);
    for (const id of [priced.notice.id, submitted.notice.id, licence.notice.id]) expect((await schema.db.notification.findUniqueOrThrow({ where: { id } })).channelsSent).toContain("EMAIL");
    expect(await run(send)).toMatchObject({ due: 0, done: 0 });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("lets two simultaneous runs send each notification only once", async () => {
    const { notice } = await jobNotice(), send = mailer();
    const results = await Promise.all([run(send), run(send)]);
    expect(results.reduce((sum, result) => sum + result.done, 0)).toBe(1);
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.any(Object), `${notice.id}:EMAIL`);
  });

  it.each(["job.priced", "job.submitted"] as const)("skips %s when the customer has already acted before the scheduler", async event => {
    const { customer, job, notice } = await jobNotice(event);
    const effects = { audit: async () => {}, notify: async () => {} };
    if (event === "job.priced") {
      await schema.db.payment.create({ data: { jobId: job.id, kind: "JOB", amountCents: job.priceCents!, status: "PAID", paidAt: new Date(), idempotencyKey: randomUUID() } });
      await transitionJob(schema.db, effects, { jobId: job.id, transition: "mark-paid", actor: { role: "SYSTEM", source: "email-test" } });
    } else await transitionJob(schema.db, effects, { jobId: job.id, transition: "sign-off", actor: { role: "CUSTOMER", userId: customer.userId } });
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(event === "job.priced" ? "BOOKABLE" : "COMPLETED");
    const send = mailer();
    expect(await run(send)).toMatchObject({ due: 1, done: 0, skipped: 1 });
    expect(send).not.toHaveBeenCalled();
    expect((await schema.db.notification.findUniqueOrThrow({ where: { id: notice.id } })).channelsSent).toContain("EMAIL");
    expect(await run(send)).toMatchObject({ due: 0, done: 0 });
  });

  it("coalesces real replacement-price publications into one current-price email across concurrent runs", async () => {
    const customer = await person("CUSTOMER"), office = { ...await person("ADMIN"), role: "ADMIN" as const };
    const job = await schema.db.job.create({ data: { customerId: customer.userId, category: "OTHER", title: "Sub wiring", description: "Replace the old wiring.", addressLine1: "1 Example Street", suburb: "Windsor", city: "Invercargill" } });
    async function publish(hours: string) {
      const fields = { jobId: job.id, hours, materials: "0.00" };
      const preview = await readOfficePricePreview(schema.db, office, fields);
      expect(preview.ok).toBe(true); if (!preview.ok) throw new Error("Expected a real price preview");
      expect(await publishOfficePrice(schema.db, office, { ...fields, token: preview.preview.token, requestId: randomUUID() })).toEqual({ ok: true });
    }
    await publish("2");
    await transitionJob(schema.db, { audit: async () => {}, notify: async () => {} }, { jobId: job.id, transition: "override", actor: office, to: "REVIEW", reason: "Replace the first published price." });
    await publish("3");
    const notices = await schema.db.notification.findMany({ where: { userId: customer.userId, type: "job.priced" } });
    expect(notices).toHaveLength(2);
    const latest = await schema.db.job.findUniqueOrThrow({ where: { id: job.id } }), send = mailer();
    const results = await Promise.all([run(send), run(send)]);
    expect(results.reduce((sum, result) => sum + result.done, 0)).toBe(1);
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ subject: `Your price is ready · Sub wiring · ${money(latest.priceCents!)}` }), expect.any(String));
    expect(notices.map(row => `${row.id}:EMAIL`)).toContain(send.mock.calls[0][1]);
    expect(await schema.db.notification.count({ where: { id: { in: notices.map(row => row.id) }, channelsSent: { has: "EMAIL" } } })).toBe(2);
    expect(await run(send)).toMatchObject({ due: 0, done: 0 });
  });

  it("coalesces pending sign-off notices after rework, even with equal notification clocks", async () => {
    const { customer, worker, job } = await jobNotice("job.submitted"), office = { ...await person("ADMIN"), role: "ADMIN" as const };
    const effects = { audit: async () => {}, notify: async () => {} };
    await transitionJob(schema.db, effects, { jobId: job.id, transition: "override", actor: office, to: "ASSIGNED", reason: "The worker needs to finish the rework." });
    await schema.db.jobMaterials.create({ data: { jobId: job.id, budgetCents: 0, spentCents: 0, spentAt: new Date() } });
    await schema.db.completionEvidence.create({ data: { jobId: job.id, workerId: worker.userId, cocNumber: "TEST-110", cocPath: `evidence/${job.id}/certificate.pdf`, declaration: "I did this work.", declaredAt: new Date(), submittedAt: new Date() } });
    await transitionJob(schema.db, effects, { jobId: job.id, transition: "submit", actor: { userId: worker.userId, role: "TRADIE" } });
    await createNotify(schema.db)("job.submitted", [customer.userId], { eventId: `job.submitted:${job.id}:${randomUUID()}`, payload: { jobId: job.id, jobNumber: job.jobNumber } });
    await schema.db.notification.updateMany({ where: { userId: customer.userId, type: "job.submitted" }, data: { createdAt: new Date() } });
    const send = mailer(), results = await Promise.all([run(send), run(send)]);
    expect(results.reduce((sum, result) => sum + result.done, 0)).toBe(1);
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ subject: "Jack’s finished. All good? · Please check within 48 hours" }), expect.any(String));
    expect(await schema.db.notification.count({ where: { userId: customer.userId, type: "job.submitted", channelsSent: { has: "EMAIL" } } })).toBe(2);
    expect(await run(send)).toMatchObject({ due: 0, done: 0 });
  });

  it("takes only the oldest five notices of each event per run", async () => {
    const rows = [];
    for (let i = 0; i < 7; i++) rows.push((await jobNotice()).notice);
    const ordered = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    const send = mailer();
    expect(await run(send)).toMatchObject({ due: 5, done: 5 });
    expect(send.mock.calls.map(([, key]) => key)).toEqual(ordered.slice(0, 5).map(row => `${row.id}:EMAIL`));
    expect(await run(send)).toMatchObject({ due: 2, done: 2 });
  });

  it.each(["role", "email", "preference"] as const)("rechecks %s after candidate selection before claiming", async change => {
    const { customer, notice } = await jobNotice();
    const find = schema.db.notification.findMany.bind(schema.db.notification);
    vi.spyOn(schema.db.notification, "findMany").mockImplementationOnce(((args: Parameters<typeof find>[0]) => find(args).then(async rows => {
      if (change === "role") await schema.db.profile.update({ where: { id: customer.userId }, data: { role: "TRADIE" } });
      if (change === "email") await schema.db.profile.update({ where: { id: customer.userId }, data: { emailVerifiedAt: null } });
      if (change === "preference") await schema.db.notificationPreference.create({ data: { userId: customer.userId, event: "job.priced", channel: "EMAIL", enabled: false } });
      return rows;
    })) as typeof find);
    const send = mailer();
    expect(await run(send)).toMatchObject({ due: 1, done: 0, skipped: 1 });
    expect(send).not.toHaveBeenCalled();
    expect((await schema.db.notification.findUniqueOrThrow({ where: { id: notice.id } })).channelsSent).not.toContain("EMAIL");
  });

  it("ignores preferences off, unconfirmed email, old notices, tradie prices and unrelated events", async () => {
    const off = await jobNotice(), unconfirmed = await jobNotice(), old = await jobNotice(), tradie = await jobNotice();
    await schema.db.notificationPreference.create({ data: { userId: off.customer.userId, event: "job.priced", channel: "EMAIL", enabled: false } });
    await schema.db.profile.update({ where: { id: unconfirmed.customer.userId }, data: { emailVerifiedAt: null } });
    await schema.db.notification.update({ where: { id: old.notice.id }, data: { createdAt: new Date(Date.now() - 61 * 60000) } });
    await createNotify(schema.db)("job.priced", [tradie.worker.userId], { eventId: `tradie.price:${tradie.job.id}`, payload: { jobId: tradie.job.id } });
    await schema.db.notification.delete({ where: { id: tradie.notice.id } });
    await createNotify(schema.db)("job.posted", [tradie.customer.userId], { eventId: `posted:${tradie.job.id}`, payload: { jobId: tradie.job.id } });
    const send = mailer();
    expect(await run(send)).toMatchObject({ due: 0, done: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(await schema.db.notification.count({ where: { channelsSent: { has: "EMAIL" } } })).toBe(0);
  });

  it("retries a failure with the same key and preserves a concurrent PUSH mark", async () => {
    const { notice } = await jobNotice();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn<ContactMailer>(async () => {
      await schema.db.notification.update({ where: { id: notice.id }, data: { channelsSent: { push: "PUSH" } } });
      return false;
    });
    expect(await run(send)).toMatchObject({ failed: 1, done: 0 });
    expect((await schema.db.notification.findUniqueOrThrow({ where: { id: notice.id } })).channelsSent).toEqual(["PUSH"]);
    send.mockResolvedValueOnce(true);
    expect(await run(send)).toMatchObject({ done: 1, failed: 0 });
    expect(send.mock.calls.map(([, key]) => key)).toEqual([`${notice.id}:EMAIL`, `${notice.id}:EMAIL`]);
    expect((await schema.db.notification.findUniqueOrThrow({ where: { id: notice.id } })).channelsSent).toEqual(["PUSH", "EMAIL"]);
  });

  it("ends retries after sixty minutes and logs only counts", async () => {
    const { notice } = await jobNotice(), log = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn<ContactMailer>(async () => { throw new Error("PRIVATE ADDRESS AND BODY"); });
    expect(await run(send)).toMatchObject({ failed: 1 });
    expect(await run(send, new Date(Date.now() + 61 * 60000))).toMatchObject({ due: 0, done: 0 });
    expect(send).toHaveBeenCalledOnce();
    expect((await schema.db.notification.findUniqueOrThrow({ where: { id: notice.id } })).channelsSent).not.toContain("EMAIL");
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE|@example|Sub wiring/);
  });

  it("does not send or mark anything without a configured mailer", async () => {
    const { notice } = await jobNotice();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await createNotificationEmailRule().run({ db: schema.db, now: new Date(), limit: 5 })).toMatchObject({ due: 0, done: 0, failed: 0 });
    expect(await run(null)).toMatchObject({ done: 0, failed: 0 });
    expect((await schema.db.notification.findUniqueOrThrow({ where: { id: notice.id } })).channelsSent).not.toContain("EMAIL");
    expect(log).not.toHaveBeenCalled();
  });

  it("marks and skips a foreign job instead of trusting a notification payload", async () => {
    const { customer, job, notice } = await jobNotice(), outsider = await person("CUSTOMER", "Other");
    await schema.db.notification.delete({ where: { id: notice.id } });
    const result = await createNotify(schema.db)("job.priced", [outsider.userId], { eventId: `foreign:${job.id}`, payload: { jobId: job.id } });
    const send = mailer();
    expect(await run(send)).toMatchObject({ due: 1, done: 0, skipped: 1 });
    expect(send).not.toHaveBeenCalled();
    expect((await schema.db.notification.findUniqueOrThrow({ where: { id: result.notifications[0].id } })).channelsSent).toContain("EMAIL");
    expect(customer.userId).not.toBe(outsider.userId);
  });

  it("recovers the first-approval event identity from the real producer without inventing a payload", async () => {
    const { worker, licence, notice, version } = await approvedLicence();
    const candidate = licenceReviewVersion({ ...licence, status: "PENDING", updatedAt: licence.createdAt, checkedAt: null, checkedById: null });
    expect(notice.payload).toEqual({});
    expect(candidate).toBe(version);
    expect(notificationId(`licence.verified:${licence.id}:${candidate}`, worker.userId)).toBe(notice.id);
  });

  it("cannot falsely prove a resubmitted licence with the first-submission clock", async () => {
    const { worker, licence, notice, version } = await approvedLicence(true);
    const candidate = licenceReviewVersion({ ...licence, status: "PENDING", updatedAt: licence.createdAt, checkedAt: null, checkedById: null });
    expect(candidate).not.toBe(version);
    expect(notificationId(`licence.verified:${licence.id}:${candidate}`, worker.userId)).not.toBe(notice.id);
    const send = mailer();
    expect(await run(send)).toMatchObject({ due: 1, done: 0, skipped: 1 });
    expect(send).not.toHaveBeenCalled();
    expect((await schema.db.notification.findUniqueOrThrow({ where: { id: notice.id } })).channelsSent).toContain("EMAIL");
  });
});
