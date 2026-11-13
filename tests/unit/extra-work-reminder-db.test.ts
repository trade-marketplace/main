import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/generated/prisma/client";
import { priceJob } from "@/server/pricing/price-job";
import { priceVariation } from "@/server/variations/price";
import { extraWorkReminder } from "@/server/scheduler/extra-work-reminder";
import { NOTIFICATION_EVENTS } from "@/server/notifications/events";
import { inboxItem } from "@/server/notifications/inbox";
import { notificationId } from "@/server/notifications/notify";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

const HOUR = 3_600_000;

describe.skipIf(!testDatabaseUrl)("priced extra-work reminder (database)", () => {
  const schema = useTestSchema(import.meta.filename);
  const jobs: string[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    await schema.db.job.deleteMany({ where: { id: { in: jobs.splice(0) } } });
  });
  async function person(role: Role) {
    const id = randomUUID();
    await schema.db.$executeRaw`INSERT INTO auth.users(id) VALUES(${id}::uuid)`;
    await schema.db.profile.create({ data: { id, role, firstName: "Test", email: `${id}@example.test` } });
    return { userId: id };
  }
  async function fixture() {
    const customer = await person("CUSTOMER"), worker = await person("TRADIE"), office = await person("ADMIN");
    const job = await schema.db.job.create({ data: { customerId: customer.userId, category: "OTHER", title: `Reminder ${randomUUID()}`, description: "Hang a door", addressLine1: "539 Test Street", suburb: "Windsor", city: "Invercargill" } });
    jobs.push(job.id);
    expect(await priceJob(schema.db, { jobId: job.id, minutes: 60, materialsCents: 0 })).toMatchObject({ ok: true });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "ASSIGNED", workerId: worker.userId } });
    // Legacy rows are supported too. Request creation/payment behavior belongs to the command suites.
    const variation = await schema.db.variation.create({ data: { jobId: job.id, requestedById: worker.userId, description: "Hang another door", requestedMinutes: 30 } });
    const priced = await priceVariation(schema.db, office, variation.id, 0, 30);
    if (!priced.ok) throw Error(priced.error);
    const saved = await schema.db.variation.findUniqueOrThrow({ where: { id: variation.id } });
    if (!saved.pricedAt) throw Error("The database did not stamp the price time");
    return { customer, worker, office, job, id: variation.id, revision: saved.revision, pricedAt: saved.pricedAt };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  // Postgres stamps microseconds; use the first representable JS clock tick at/after that age.
  const at = (f: Fixture, hours: number) => new Date(f.pricedAt.getTime() + hours * HOUR + 1);
  const key = (f: Fixture) => `extra-work-reminder:${f.id}:${f.revision}`;
  const run = (now: Date, limit = 100) => extraWorkReminder.run({ db: schema.db, now, limit });
  const notices = (f: Fixture) => schema.db.notification.findMany({ where: { type: "variation.reminder", payload: { path: ["variationId"], equals: f.id } } });

  it("accepts the exact prescribed revision mark against the fully migrated schema", async () => {
    const f = await fixture();
    // This contract deliberately stays red until #582 admits the planned key; no fixture DDL or alternate key.
    await expect(schema.db.scheduledJobMark.createMany({ data: [{ rule: key(f), jobId: f.job.id }], skipDuplicates: true })).resolves.toEqual({ count: 1 });
  });

  it("sends nothing at 23 hours, then one customer-only in-app reminder at the 24-hour threshold", async () => {
    const f = await fixture();
    expect(await run(at(f, 23))).toEqual({ rule: "extra-work-reminder", due: 0, done: 0, skipped: 0, failed: 0 });
    expect(await notices(f)).toHaveLength(0);
    expect(await run(at(f, 24))).toMatchObject({ due: 1, done: 1, failed: 0 });
    const rows = await notices(f); expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: notificationId(`variation.reminder:${f.id}:${f.revision}`, f.customer.userId), userId: f.customer.userId, payload: { jobId: f.job.id, jobNumber: f.job.jobNumber, variationId: f.id } });
    expect(inboxItem(rows[0])).toMatchObject({ line: "Extra work still needs your OK", icon: "schedule", href: `/jobs/${f.job.id}` });
    expect(NOTIFICATION_EVENTS["variation.reminder"]).toEqual({ channels: ["IN_APP"], description: "Priced extra work is still waiting on the customer." });
    expect(await schema.db.notification.count({ where: { type: "variation.reminder", userId: { in: [f.worker.userId, f.office.userId] } } })).toBe(0);
    expect(await schema.db.scheduledJobMark.findUnique({ where: { rule_jobId: { rule: key(f), jobId: f.job.id } } })).toMatchObject({ markedAt: at(f, 24) });
    expect(await schema.db.variation.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({ status: "PRICED", revision: f.revision });
    expect(await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).toMatchObject({ status: "ASSIGNED", workerId: f.worker.userId });
  });

  it("is safe when two runs start together, and late replays preserve the notice and read state", async () => {
    const f = await fixture();
    const results = await Promise.all([run(at(f, 24)), run(at(f, 24))]);
    expect(results.reduce((sum, result) => sum + result.done, 0)).toBe(1);
    expect(results.reduce((sum, result) => sum + result.failed, 0)).toBe(0);
    const before = await notices(f); expect(before).toHaveLength(1);
    const readAt = at(f, 25); await schema.db.notification.update({ where: { id: before[0].id }, data: { readAt } });
    expect(await run(at(f, 240))).toMatchObject({ due: 0, done: 0, failed: 0 });
    expect(await notices(f)).toEqual([{ ...before[0], readAt }]);
    expect(await schema.db.scheduledJobMark.count({ where: { jobId: f.job.id, rule: key(f) } })).toBe(1);
  });

  it("gives a revised price its own 24-hour clock and once-only reminder", async () => {
    const f = await fixture(); expect(await run(at(f, 24))).toMatchObject({ done: 1 });
    const price = await priceVariation(schema.db, f.office, f.id, f.revision, 45); expect(price.ok).toBe(true);
    const revised = await schema.db.variation.findUniqueOrThrow({ where: { id: f.id } });
    const next = { ...f, revision: revised.revision, pricedAt: revised.pricedAt! };
    expect(await run(at(next, 23))).toMatchObject({ due: 0 });
    expect(await run(at(next, 24))).toMatchObject({ done: 1 });
    expect(await run(at(next, 240))).toMatchObject({ due: 0 });
    expect((await notices(f)).map(row => row.id).sort()).toEqual([notificationId(`variation.reminder:${f.id}:${f.revision}`, f.customer.userId), notificationId(`variation.reminder:${f.id}:${next.revision}`, f.customer.userId)].sort());
    expect(await schema.db.scheduledJobMark.count({ where: { jobId: f.job.id } })).toBe(2);
  });

  it("finds the oldest unmarked rows before applying limit and drains the backlog on the next run", async () => {
    const first = await fixture(), second = await fixture(), third = await fixture();
    const now = at(third, 240);
    expect(await run(now, 1)).toMatchObject({ due: 1, done: 1 });
    expect(await notices(first)).toHaveLength(1); expect(await notices(second)).toHaveLength(0); expect(await notices(third)).toHaveLength(0);
    expect(await run(now, 1)).toMatchObject({ due: 1, done: 1 });
    expect(await notices(second)).toHaveLength(1); expect(await notices(third)).toHaveLength(0);
    expect(await run(now, 1)).toMatchObject({ due: 1, done: 1 }); expect(await notices(third)).toHaveLength(1);
    expect(await run(now, 1)).toMatchObject({ due: 0, done: 0 });
  });

  it("excludes approved, declined and no-longer-assigned jobs without marks or notices", async () => {
    const approved = await fixture(), declined = await fixture(), cancelled = await fixture();
    await schema.db.variation.update({ where: { id: approved.id }, data: { status: "APPROVED" } });
    await schema.db.variation.update({ where: { id: declined.id }, data: { status: "DECLINED" } });
    await schema.db.job.update({ where: { id: cancelled.job.id }, data: { status: "CANCEL_REVIEW" } });
    expect(await run(at(cancelled, 240))).toMatchObject({ due: 0, done: 0, failed: 0 });
    for (const f of [approved, declined, cancelled]) {
      expect(await notices(f)).toHaveLength(0);
      expect(await schema.db.scheduledJobMark.count({ where: { jobId: f.job.id } })).toBe(0);
    }
  });

  it.each(["approved", "declined", "repriced", "job moved"] as const)("rechecks a stale due candidate when it was %s before the transaction", async change => {
    const f = await fixture();
    if (change === "repriced") expect(await priceVariation(schema.db, f.office, f.id, f.revision, 45)).toMatchObject({ ok: true });
    else if (change === "job moved") await schema.db.job.update({ where: { id: f.job.id }, data: { status: "CANCEL_REVIEW" } });
    else await schema.db.variation.update({ where: { id: f.id }, data: { status: change === "approved" ? "APPROVED" : "DECLINED" } });
    vi.spyOn(schema.db, "$queryRaw").mockResolvedValueOnce([{ id: f.id, jobId: f.job.id, revision: f.revision }]);
    expect(await run(at(f, 24))).toMatchObject({ due: 1, done: 0, skipped: 1, failed: 0 });
    expect(await notices(f)).toHaveLength(0);
    expect(await schema.db.scheduledJobMark.count({ where: { jobId: f.job.id } })).toBe(0);
  });
});
