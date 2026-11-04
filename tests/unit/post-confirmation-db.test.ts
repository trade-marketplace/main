import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPostConfirmationRule, enqueuePostConfirmation, POST_CONFIRMATION_MAX_ATTEMPTS, POST_CONFIRMATION_RETRY_WINDOW_MS } from "@/server/notifications/post-confirmation";
import { postJob } from "@/server/jobs/post-job";
import type { ContactMailer } from "@/server/contact";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("durable posted confirmation emails (database)", () => {
  const schema = useTestSchema(import.meta.filename);
  const now = new Date("2026-11-03T12:00:00Z");
  afterEach(async () => { await schema.db.jobPostConfirmation.deleteMany(); });
  async function customer() {
    const id = randomUUID(); const email = `${id}@example.test`;
    await schema.db.$executeRaw`INSERT INTO auth.users (id) VALUES (${id}::uuid)`;
    await schema.db.profile.create({ data: { id, email, role: "CUSTOMER", firstName: "Customer", emailVerifiedAt: now } });
    return { userId: id, email, role: "CUSTOMER" as const, firstName: "Customer", emailVerified: true };
  }
  async function queued() {
    const person = await customer();
    const job = await schema.db.job.create({ data: { customerId: person.userId, category: "OTHER", title: "Move the sofa upstairs", description: "Move the sofa upstairs", addressLine1: "1 Example Street", suburb: "Gladstone", city: "Invercargill", status: "REVIEW" } });
    await schema.db.$transaction(tx => enqueuePostConfirmation(tx, { jobId: job.id, customerId: person.userId, recipientEmail: person.email, jobNumber: job.jobNumber, title: job.title }));
    // Queue creation defaults to the database clock; tests use an injected business clock, independently of budgets.
    await schema.db.jobPostConfirmation.update({ where: { jobId: job.id }, data: { createdAt: now, dueAt: now } });
    return { person, job };
  }
  const run = (mailer: ContactMailer | null, at = now, extra: { wallClock?: () => number; deadlineAt?: Date; limit?: number } = {}) =>
    createPostConfirmationRule({ mailer, wallClock: extra.wallClock ?? (() => 0) }).run({ db: schema.db, now: at, limit: extra.limit ?? 200, deadlineAt: extra.deadlineAt ?? new Date(45_000) });

  it("enqueues only with actual creation, rolls back atomically, and never backfills an owned replay", async () => {
    const person = await customer(); const key = randomUUID();
    const data = { postKey: key, description: "Move the sofa upstairs", category: "OTHER", photoPaths: [], addressLine1: "1 Example Street", suburb: "Gladstone", city: "Invercargill", locationSource: "TYPED", anyTime: true, timeWindows: [] };
    const deps = { now: () => now, rateLimit: async () => ({ allowed: true } as const), notifyWorkers: async () => {} };
    const result = await postJob(schema.db, person, data, key, deps);
    expect(result.status).toBe("posted"); if (result.status !== "posted") return;
    const row = await schema.db.jobPostConfirmation.findUniqueOrThrow({ where: { jobId: result.jobId } });
    expect(row).toMatchObject({ customerId: person.userId, recipientEmail: person.email, title: data.description, attempts: 0, deliveredAt: null, firstAttemptAt: null });
    expect(await schema.db.notification.count({ where: { userId: person.userId } })).toBe(0);
    await schema.db.jobPostConfirmation.delete({ where: { jobId: result.jobId } });
    expect(await postJob(schema.db, person, {}, key, deps)).toEqual(result);
    expect(await schema.db.jobPostConfirmation.count({ where: { jobId: result.jobId } })).toBe(0);

    const rolledBackJobId = randomUUID();
    await expect(schema.db.$transaction(async tx => {
      const job = await tx.job.create({ data: { id: rolledBackJobId, customerId: person.userId, category: "OTHER", title: data.description, description: data.description, addressLine1: data.addressLine1, suburb: data.suburb, city: data.city, status: "REVIEW" } });
      await enqueuePostConfirmation(tx, { jobId: job.id, customerId: person.userId, recipientEmail: person.email, jobNumber: job.jobNumber, title: job.title });
      throw new Error("Business transaction failed");
    })).rejects.toThrow("Business transaction failed");
    expect(await schema.db.job.count({ where: { id: rolledBackJobId } })).toBe(0);
    expect(await schema.db.jobPostConfirmation.count({ where: { jobId: rolledBackJobId } })).toBe(0);
  });

  it("commits the lease before delivery and marks only an accepted provider response", async () => {
    const { job } = await queued(); const frozen = await schema.db.jobPostConfirmation.findUniqueOrThrow({ where: { jobId: job.id } });
    const mailer = vi.fn<ContactMailer>(async (message, key) => {
      expect(message).toEqual(frozen.message); expect(key).toBe(`posted:${job.id}:EMAIL`);
      // NOWAIT would fail if the network provider were called from inside the claim transaction.
      await schema.db.$transaction(async tx => { await tx.$queryRawUnsafe(`SELECT job_id FROM "${schema.name}".job_post_confirmations WHERE job_id = $1::uuid FOR UPDATE NOWAIT`, job.id); });
      return true;
    });
    expect(await run(mailer)).toMatchObject({ done: 1, failed: 0 });
    expect(await schema.db.jobPostConfirmation.findUniqueOrThrow({ where: { jobId: job.id } })).toMatchObject({ deliveredAt: now, attempts: 1, firstAttemptAt: now, leaseToken: null, leasedUntil: null, failedAt: null });
    expect((await run(mailer)).done).toBe(0); expect(mailer).toHaveBeenCalledTimes(1);
  });

  it("retries a refused response without claiming delivery", async () => {
    const { job } = await queued(); const mailer = vi.fn<ContactMailer>().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect((await run(mailer)).failed).toBe(1);
    const row = await schema.db.jobPostConfirmation.findUniqueOrThrow({ where: { jobId: job.id } });
    expect(row).toMatchObject({ deliveredAt: null, failedAt: null, attempts: 1, firstAttemptAt: now, leaseToken: null });
    expect(row.dueAt.getTime()).toBe(now.getTime() + 60_000);
    expect((await run(mailer, new Date(now.getTime() + 59_999))).done).toBe(0);
    expect((await run(mailer, row.dueAt)).done).toBe(1);
    expect(mailer.mock.calls[1]).toEqual(mailer.mock.calls[0]);
  });

  it("reuses the frozen body/key after a provider accepted a response that was lost", async () => {
    const { job } = await queued(); const accepted = new Map<string, string>(); let first = true;
    const mailer = vi.fn<ContactMailer>(async (message, key) => {
      const body = JSON.stringify(message);
      if (accepted.has(key)) expect(body).toBe(accepted.get(key)); else accepted.set(key, body);
      if (first) { first = false; throw new Error("Private recipient and provider body must never be logged"); }
      return true;
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await run(mailer)).failed).toBe(1);
      const retry = await schema.db.jobPostConfirmation.findUniqueOrThrow({ where: { jobId: job.id } });
      await schema.db.job.update({ where: { id: job.id }, data: { title: "A later title must not alter an existing provider payload" } });
      expect((await run(mailer, retry.dueAt)).done).toBe(1);
      expect(accepted.size).toBe(1); expect(mailer.mock.calls[1]).toEqual(mailer.mock.calls[0]);
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/Private recipient|provider body|example\.test/);
    } finally { log.mockRestore(); }
  });

  it("lets only one concurrent worker deliver an active lease", async () => {
    await queued(); let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
    const mailer = vi.fn<ContactMailer>(async () => { entered(); await gate; return true; });
    const first = run(mailer); const second = run(mailer);
    await started; release();
    const results = await Promise.all([first, second]);
    expect(results.reduce((sum, result) => sum + result.done, 0)).toBe(1); expect(mailer).toHaveBeenCalledTimes(1);
  });

  it("recovers provider acceptance after a failed completion write with the same key and body", async () => {
    const { job } = await queued(); const accepted = new Map<string, string>();
    const mailer = vi.fn<ContactMailer>(async (message, key) => {
      if (accepted.has(key)) expect(JSON.stringify(message)).toBe(accepted.get(key));
      else accepted.set(key, JSON.stringify(message));
      return true;
    });
    await schema.db.$executeRawUnsafe(`CREATE FUNCTION "${schema.name}".reject_email_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.delivered_at IS NOT NULL THEN RAISE EXCEPTION 'completion write failed'; END IF; RETURN NEW; END $$`);
    await schema.db.$executeRawUnsafe(`CREATE TRIGGER reject_email_completion BEFORE UPDATE ON "${schema.name}".job_post_confirmations FOR EACH ROW EXECUTE FUNCTION "${schema.name}".reject_email_completion()`);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect((await run(mailer)).failed).toBe(1); }
    finally { await schema.db.$executeRawUnsafe(`DROP TRIGGER reject_email_completion ON "${schema.name}".job_post_confirmations`); log.mockRestore(); }
    const row = await schema.db.jobPostConfirmation.findUniqueOrThrow({ where: { jobId: job.id } });
    expect(row.deliveredAt).toBeNull(); expect(row.leaseToken).not.toBeNull();
    expect((await run(mailer, new Date(now.getTime() + 30_001))).done).toBe(1);
    expect(accepted.size).toBe(1); expect(mailer.mock.calls[1]).toEqual(mailer.mock.calls[0]);
  });

  it("recovers an expired lease without letting a stale completion overwrite the new owner", async () => {
    const { job } = await queued(); let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
    const first = run(async () => { entered(); await gate; return true; });
    await started;
    const later = new Date(now.getTime() + 30_001);
    expect((await run(async () => true, later)).done).toBe(1);
    release(); expect((await first).done).toBe(0);
    expect(await schema.db.jobPostConfirmation.findUniqueOrThrow({ where: { jobId: job.id } })).toMatchObject({ deliveredAt: later, failedAt: null, attempts: 2, leaseToken: null });
  });

  it.each(["email", "proof", "role", "owner", "payload"])("rechecks current recipient authority before sending: %s", async changed => {
    const { job, person } = await queued();
    if (changed === "email") await schema.db.profile.update({ where: { id: person.userId }, data: { email: "changed@example.test" } });
    if (changed === "proof") await schema.db.profile.update({ where: { id: person.userId }, data: { emailVerifiedAt: null } });
    if (changed === "role") await schema.db.profile.update({ where: { id: person.userId }, data: { role: "TRADIE" } });
    if (changed === "owner") { const other = await customer(); await schema.db.job.update({ where: { id: job.id }, data: { customerId: other.userId } }); }
    if (changed === "payload") {
      const row = await schema.db.jobPostConfirmation.findUniqueOrThrow({ where: { jobId: job.id } });
      await schema.db.jobPostConfirmation.update({ where: { jobId: job.id }, data: { message: { ...row.message as object, to: "foreign@example.test" } } });
    }
    const mailer = vi.fn<ContactMailer>(async () => true); await run(mailer);
    expect(mailer).not.toHaveBeenCalled();
    expect(await schema.db.jobPostConfirmation.findUniqueOrThrow({ where: { jobId: job.id } })).toMatchObject({ deliveredAt: null, failedAt: now });
  });

  it("bounds attempts and retry-key lifetime without treating the creation age as an email deadline", async () => {
    const { job } = await queued();
    await schema.db.jobPostConfirmation.update({ where: { jobId: job.id }, data: { createdAt: new Date(now.getTime() - 30 * 60 * 60 * 1_000) } });
    const mailer = vi.fn<ContactMailer>(async () => true); expect((await run(mailer)).done).toBe(1);
    for (const exhausted of [{ attempts: POST_CONFIRMATION_MAX_ATTEMPTS, firstAttemptAt: now }, { attempts: 1, firstAttemptAt: new Date(now.getTime() - POST_CONFIRMATION_RETRY_WINDOW_MS) }]) {
      const next = await queued();
      await schema.db.jobPostConfirmation.update({ where: { jobId: next.job.id }, data: exhausted });
      await run(mailer);
      expect(await schema.db.jobPostConfirmation.findUniqueOrThrow({ where: { jobId: next.job.id } })).toMatchObject({ deliveredAt: null, failedAt: now });
    }
    expect(mailer).toHaveBeenCalledTimes(1);
  });

  it("caps a batch and reserves provider/commit time from the shared deadline", async () => {
    await queued(); await queued(); await queued(); const mailer = vi.fn<ContactMailer>(async () => true);
    expect(await run(mailer, now, { deadlineAt: new Date(11_999) })).toMatchObject({ due: 0, done: 0 });
    expect(mailer).not.toHaveBeenCalled();
    expect(await run(mailer)).toMatchObject({ due: 2, done: 2 });
    expect(mailer).toHaveBeenCalledTimes(2);
    let clock = 0;
    await queued();
    const slow = vi.fn<ContactMailer>(async () => { clock = 34_000; return true; });
    expect(await run(slow, now, { wallClock: () => clock })).toMatchObject({ due: 2, done: 1, skipped: 1 });
    expect(slow).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("preserves unsent attempt budget and the existing provider anchor after a slow claim (prior attempt: %s)", async priorAttempt => {
    const { job } = await queued();
    if (priorAttempt) await run(async () => false);
    const before = await schema.db.jobPostConfirmation.findUniqueOrThrow({ where: { jobId: job.id } });
    let clock = 0;
    const delayed = schema.db.$extends({ query: { profile: { async findUnique({ args, query }) {
      const profile = await query(args); clock = 1_000; return profile;
    } } } });
    const mailer = vi.fn<ContactMailer>(async () => true);
    const result = await createPostConfirmationRule({ mailer, wallClock: () => clock }).run({ db: delayed as unknown as typeof schema.db, now: before.dueAt, limit: 2, deadlineAt: new Date(12_000) });
    expect(result).toMatchObject({ done: 0, skipped: 1 }); expect(mailer).not.toHaveBeenCalled();
    expect(await schema.db.jobPostConfirmation.findUniqueOrThrow({ where: { jobId: job.id } })).toMatchObject({
      attempts: before.attempts, firstAttemptAt: before.firstAttemptAt, deliveredAt: null, failedAt: null, leaseToken: null, leasedUntil: null,
    });
    expect((await run(mailer, before.dueAt)).done).toBe(1);
    expect(await schema.db.jobPostConfirmation.findUniqueOrThrow({ where: { jobId: job.id } })).toMatchObject({
      attempts: before.attempts + 1, firstAttemptAt: before.firstAttemptAt ?? before.dueAt,
    });
  });

  it("does not invent acceptance or start the provider retention clock when mail is unconfigured", async () => {
    const { job } = await queued(); expect((await run(null)).failed).toBe(1);
    expect(await schema.db.jobPostConfirmation.findUniqueOrThrow({ where: { jobId: job.id } })).toMatchObject({ attempts: 0, firstAttemptAt: null, deliveredAt: null, failedAt: null });
  });
});
