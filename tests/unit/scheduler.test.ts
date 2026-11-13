import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { JobStatus, Prisma, PrismaClient, Role } from "@/generated/prisma/client";
import { handleSchedulerPost, refuseOtherMethods } from "@/server/scheduler/handler";
import { isSchedulerRequest } from "@/server/scheduler/auth";
import { runScheduledRules } from "@/server/scheduler/runner";
import { SCHEDULER_RULES, type SchedulerRule, unclaimedAlert } from "@/server/scheduler/rules";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

// The scheduled jobs runner (#99): the protected endpoint, the runner, then every rule against a real database.

const SECRET = "s".repeat(40);
const ENV = { SCHEDULER_SECRET: SECRET };
const HOUR = 3_600_000;

function post(authorization?: string) {
  return new Request("http://localhost/api/scheduler/run", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

describe("the scheduler endpoint", () => {
  const db = {} as PrismaClient;
  const summary = { ranAt: "2026-11-02T00:00:00.000Z", rules: [] };

  it("runs the rules for the right secret and answers with counts only", async () => {
    const run = vi.fn().mockResolvedValue(summary);
    const response = await handleSchedulerPost(post(`Bearer ${SECRET}`), { env: ENV, getDb: () => db, run });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(summary);
    expect(run).toHaveBeenCalledWith(db);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("is never callable by the public: no token, a wrong token and the wrong scheme are all refused", async () => {
    const run = vi.fn();
    for (const header of [undefined, `Bearer ${"x".repeat(40)}`, `Bearer ${SECRET}x`, SECRET, `Basic ${SECRET}`, "Bearer "]) {
      const response = await handleSchedulerPost(post(header), { env: ENV, getDb: () => db, run });
      expect(response.status).toBe(401);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("says it isn't set up, and runs nothing, when no secret is configured", async () => {
    const run = vi.fn();
    const response = await handleSchedulerPost(post("Bearer anything"), { env: {}, getDb: () => db, run });
    expect(response.status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });

  it("answers 500 without details when the run fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = vi.fn().mockRejectedValue(new Error("secret table name"));
    const response = await handleSchedulerPost(post(`Bearer ${SECRET}`), { env: ENV, getDb: () => db, run });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret table name");
    error.mockRestore();
  });

  it("refuses every other method", () => {
    const response = refuseOtherMethods();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("compares the bearer token exactly", () => {
    expect(isSchedulerRequest(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isSchedulerRequest(`Bearer ${SECRET} `, SECRET)).toBe(false);
    expect(isSchedulerRequest(null, SECRET)).toBe(false);
  });
});

describe("the runner", () => {
  const db = {} as PrismaClient;
  const result = (rule: string) => ({ rule, due: 1, done: 1, skipped: 0, failed: 0 });

  it("runs every rule in order and passes the clock and limit", async () => {
    const calls: string[] = [];
    const rules: SchedulerRule[] = ["a", "b"].map((name) => ({
      name,
      run: async (context) => {
        calls.push(`${name}:${context.now.toISOString()}:${context.limit}`);
        return result(name);
      },
    }));
    const now = new Date("2026-11-02T01:00:00Z");
    const summary = await runScheduledRules(db, { now, limit: 5, rules });
    expect(calls).toEqual(["a:2026-11-02T01:00:00.000Z:5", "b:2026-11-02T01:00:00.000Z:5"]);
    expect(summary.rules.map((r) => r.rule)).toEqual(["a", "b"]);
  });

  it("carries on with the other rules when one fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const rules: SchedulerRule[] = [
      { name: "broken", run: async () => Promise.reject(new Error("boom")) },
      { name: "fine", run: async () => result("fine") },
    ];
    const summary = await runScheduledRules(db, { rules });
    expect(summary.rules).toEqual([{ rule: "broken", due: 0, done: 0, skipped: 0, failed: 1 }, result("fine")]);
    error.mockRestore();
  });

  it("one job that fails doesn't stop the ones behind it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const fake = {
      jobStatusHistory: { groupBy: async () => [{ jobId: "job-1" }, { jobId: "job-2" }] },
      $transaction: async () => {
        if (++calls === 1) throw new Error("boom");
        return "done";
      },
    } as unknown as PrismaClient;
    const result = await unclaimedAlert.run({ db: fake, now: new Date(), limit: 10 });
    expect(result).toEqual({ rule: "unclaimed-alert", due: 2, done: 1, skipped: 0, failed: 1 });
    error.mockRestore();
  });

  it("has the job rules and the once-only licence reminder", () => {
    expect(SCHEDULER_RULES.map((rule) => rule.name)).toEqual([
      "auto-sign-off",
      "bounty-expiry",
      "price-slow-banner",
      "unclaimed-alert",
      "review-reminder",
      "licence-expiry-reminder", "licence-upload-cleanup", "licence-document-cleanup",
      "support-photo-cleanup",
      "draft-photo-raw-cleanup", "draft-photo-cleanup", "window-expiry", "variation-photo-cleanup", "variation-stage-cleanup",
      "post-confirmation-email", "price-ready-push",
      "notification-email",
      "job-pings",
    ]);
  });
  it("shares one physical deadline without treating the injected business clock as elapsed runtime", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(2_000);
    const deadlines: (Date | undefined)[] = [];
    const rules: SchedulerRule[] = ["mail", "push"].map(name => ({ name, run: async context => { deadlines.push(context.deadlineAt); return result(name); } }));
    await runScheduledRules(db, { now: new Date("2020-01-01"), rules });
    expect(deadlines[0]?.getTime()).toBe(47_000); expect(deadlines[1]).toBe(deadlines[0]);
    clock.mockRestore();
  });
});

// ---------------------------------------------------------------- Against the database

describe.skipIf(!testDatabaseUrl)("the scheduled rules (database)", () => {
  const schema = useTestSchema(import.meta.filename);
  const db = () => schema.db;

  async function person(role: Role = "CUSTOMER") {
    const id = randomUUID();
    await db().$executeRawUnsafe(`INSERT INTO auth.users (id) VALUES ($1::uuid)`, id);
    await db().profile.create({ data: { id, email: `${id}@example.nz`, role, firstName: "Test" } });
    return id;
  }

  async function job(status: JobStatus, data: Partial<Prisma.JobUncheckedCreateInput> = {}) {
    const claimed = ["ASSIGNED", "SUBMITTED", "COMPLETED"].includes(status);
    return db().job.create({
      data: {
        customerId: await person(),
        category: "OTHER",
        title: "Hang a door",
        description: "Interior door, frame is fine.",
        addressLine1: "1 Example St",
        suburb: "Gladstone",
        city: "Invercargill",
        status,
        priceCents: ["REVIEW", "QUOTE_BOUNTY"].includes(status) ? null : 12_000,
        workerId: claimed ? await person("TRADIE") : null,
        ...data,
      },
    });
  }

  async function submitted(submittedAt: Date) {
    const created = await job("SUBMITTED");
    const jobId = created.id;
    const workerId = created.workerId as string;
    await db().jobMaterials.create({ data: { jobId, budgetCents: 0, spentCents: 0, spentAt: new Date() } });
    await db().completionEvidence.create({ data: { jobId, workerId, notes: "Hung and trimmed." } });
    await db().completionEvidencePhoto.create({ data: { jobId, path: `evidence/${jobId}/1.jpg` } });
    await db().completionEvidence.update({
      where: { jobId },
      data: { declaration: "I did this work.", declaredAt: new Date(), submittedAt },
    });
    return created;
  }

  const real = () => Date.now();
  const at = (hoursFromNow: number) => new Date(real() + hoursFromNow * HOUR);
  const status = async (id: string) => (await db().job.findUniqueOrThrow({ where: { id } })).status;
  const marks = (rule: string) => db().scheduledJobMark.findMany({ where: { rule } });
  const notifications = (type: string) => db().notification.findMany({ where: { type } });
  const run = (now: Date, rules?: readonly SchedulerRule[], limit?: number) => runScheduledRules(db(), { now, rules, limit });
  const only = (name: string) => SCHEDULER_RULES.filter((rule) => rule.name === name);

  describe("auto sign-off", () => {
    it("completes a job 48 hours after the evidence was sent, writes the audit row and tells both people", async () => {
      const { id, customerId, workerId } = await submitted(new Date());
      await run(at(47), only("auto-sign-off"));
      expect(await status(id)).toBe("SUBMITTED");

      const summary = await run(at(49), only("auto-sign-off"));
      expect(summary.rules[0]).toMatchObject({ due: 1, done: 1, failed: 0 });
      expect(await status(id)).toBe("COMPLETED");

      const history = await db().jobStatusHistory.findMany({ where: { jobId: id }, orderBy: { createdAt: "asc" } });
      expect(history.at(-1)).toMatchObject({ fromStatus: "SUBMITTED", toStatus: "COMPLETED", changedById: null });
      expect(await db().auditLog.findFirstOrThrow({ where: { recordId: id, action: "job.auto_completed" } })).toMatchObject({
        actorId: null,
        recordType: "jobs",
      });
      const told = await notifications("job.auto_completed");
      expect(told.map((n) => n.userId).sort()).toEqual([customerId, workerId].sort());
      expect(told[0].payload).toEqual({ jobId: id, jobNumber: expect.any(Number) });
    });

    it("uses the office's hours setting", async () => {
      await db().settings.update({ where: { id: 1 }, data: { autoReleaseHours: 72 } });
      const { id } = await submitted(new Date());
      await run(at(49), only("auto-sign-off"));
      expect(await status(id)).toBe("SUBMITTED");
      await run(at(73), only("auto-sign-off"));
      expect(await status(id)).toBe("COMPLETED");
      await db().settings.update({ where: { id: 1 }, data: { autoReleaseHours: 48 } });
    });

    it("leaves a job alone while a problem report is open, and completes it once that's resolved", async () => {
      const { id, customerId } = await submitted(new Date());
      const problem = await db().problemReport.create({
        data: { jobId: id, reportedById: customerId, topic: "Work not finished", details: "The door sticks." },
      });
      const summary = await run(at(60), only("auto-sign-off"));
      expect(summary.rules[0].due).toBe(0);
      expect(await status(id)).toBe("SUBMITTED");

      await db().problemReport.update({
        where: { id: problem.id },
        data: { status: "RESOLVED", resolution: "Fixed.", resolvedById: await person("ADMIN"), resolvedAt: new Date() },
      });
      await run(at(60), only("auto-sign-off"));
      expect(await status(id)).toBe("COMPLETED");
    });

    it("is safe to run twice, and doesn't undo a sign-off the customer already made", async () => {
      const signedOffBySomeoneElse = await submitted(new Date());
      const waiting = await submitted(new Date());
      await db().job.update({ where: { id: signedOffBySomeoneElse.id }, data: { status: "COMPLETED" } });

      const first = await run(at(50), only("auto-sign-off"));
      const second = await run(at(50), only("auto-sign-off"));
      expect(first.rules[0].done).toBe(1);
      expect(second.rules[0]).toMatchObject({ due: 0, done: 0 });
      expect(await status(waiting.id)).toBe("COMPLETED");
      expect(await db().auditLog.count({ where: { recordId: waiting.id, action: "job.auto_completed" } })).toBe(1);
      expect(await notifications("job.auto_completed").then((rows) => rows.filter((n) => n.payload && (n.payload as { jobId: string }).jobId === waiting.id))).toHaveLength(2);
    });

    it("two runs at the same moment complete the job once", async () => {
      const { id } = await submitted(new Date());
      await Promise.all([run(at(50), only("auto-sign-off")), run(at(50), only("auto-sign-off"))]);
      expect(await status(id)).toBe("COMPLETED");
      expect(await db().auditLog.count({ where: { recordId: id, action: "job.auto_completed" } })).toBe(1);
    });
  });

  describe("bounty expiry", () => {
    it("marks a bounty open for 24 hours as expired, tells the office once and leaves the job's status", async () => {
      const office = await person("ADMIN");
      const { id } = await job("QUOTE_BOUNTY");
      await run(at(23), only("bounty-expiry"));
      expect(await marks("bounty.expired")).toHaveLength(0);

      const summary = await run(at(25), only("bounty-expiry"));
      expect(summary.rules[0]).toMatchObject({ done: 1 });
      expect((await marks("bounty.expired")).map((m) => m.jobId)).toEqual([id]);
      expect(await status(id)).toBe("QUOTE_BOUNTY");
      expect((await notifications("bounty.expired")).map((n) => n.userId)).toContain(office);
    });

    it("is safe to run twice: one mark, one notification per office user", async () => {
      await job("QUOTE_BOUNTY");
      const before = (await notifications("bounty.expired")).length;
      await run(at(30), only("bounty-expiry"));
      await run(at(30), only("bounty-expiry"));
      const added = (await notifications("bounty.expired")).length - before;
      expect(added).toBe(await db().profile.count({ where: { role: "ADMIN" } }));
    });

    it("skips a bounty that was priced in the meantime", async () => {
      const { id } = await job("QUOTE_BOUNTY");
      await db().job.update({ where: { id }, data: { status: "REVIEW" } });
      await run(at(30), only("bounty-expiry"));
      expect((await marks("bounty.expired")).map((m) => m.jobId)).not.toContain(id);
    });
  });

  describe("unclaimed alert", () => {
    it("flags a paid job nobody has taken after 48 hours, once, and tells the office", async () => {
      const office = await person("ADMIN");
      const { id } = await job("BOOKABLE");
      await run(at(47), only("unclaimed-alert"));
      expect(await marks("job.unclaimed")).toHaveLength(0);

      await run(at(49), only("unclaimed-alert"));
      await run(at(70), only("unclaimed-alert"));
      expect((await marks("job.unclaimed")).filter((m) => m.jobId === id)).toHaveLength(1);
      const told = (await notifications("job.unclaimed")).filter((n) => n.userId === office);
      expect(told).toHaveLength(1);
    });

    it("ignores a job that was claimed", async () => {
      const claimed = await job("ASSIGNED");
      await run(at(100), only("unclaimed-alert"));
      expect((await marks("job.unclaimed")).map((m) => m.jobId)).not.toContain(claimed.id);
    });
  });

  describe("taking longer than 24h banner", () => {
    it("marks a job still waiting for its price after 24 hours, with no notification", async () => {
      const waiting = await job("REVIEW");
      const priced = await job("PRICED");
      await run(at(23), only("price-slow-banner"));
      expect((await marks("price.slow")).map((m) => m.jobId)).not.toContain(waiting.id);

      await run(at(25), only("price-slow-banner"));
      await run(at(26), only("price-slow-banner"));
      const marked = (await marks("price.slow")).map((m) => m.jobId);
      expect(marked.filter((jobId) => jobId === waiting.id)).toHaveLength(1);
      expect(marked).not.toContain(priced.id);
      expect(await notifications("price.slow")).toHaveLength(0);
    });
  });

  describe("review reminder", () => {
    it("reminds the customer once, a day after the job was completed, if there's no review", async () => {
      const { id, customerId } = await job("COMPLETED");
      await run(at(23), only("review-reminder"));
      expect((await notifications("review.reminder")).filter((n) => n.userId === customerId)).toHaveLength(0);

      await run(at(25), only("review-reminder"));
      await run(at(30), only("review-reminder"));
      expect((await notifications("review.reminder")).filter((n) => n.userId === customerId)).toHaveLength(1);
      expect((await marks("review.reminded")).map((m) => m.jobId)).toContain(id);
    });

    it("doesn't remind someone who already reviewed", async () => {
      const { id, customerId, workerId } = await job("COMPLETED");
      await db().review.create({ data: { jobId: id, reviewerId: customerId, workerId: workerId as string, rating: 5 } });
      await run(at(30), only("review-reminder"));
      expect((await marks("review.reminded")).map((m) => m.jobId)).not.toContain(id);
      expect((await notifications("review.reminder")).filter((n) => n.userId === customerId)).toHaveLength(0);
    });

    it("doesn't send a stale reminder for a job completed more than 7 days ago", async () => {
      const { id } = await job("COMPLETED");
      await run(at(24 * 8), only("review-reminder"));
      expect((await marks("review.reminded")).map((m) => m.jobId)).not.toContain(id);
    });
  });

  describe("after downtime", () => {
    it("catches up in order: the oldest are handled first and the rest follow on the next runs", async () => {
      const oldest = await submitted(new Date(real() - 30 * HOUR));
      const middle = await submitted(new Date(real() - 10 * HOUR));
      const newest = await submitted(new Date(real() - 5 * HOUR));

      // The runner was down for days: everything is overdue, but only two jobs fit in a run.
      const now = at(24 * 3);
      await run(now, only("auto-sign-off"), 2);
      expect(await status(oldest.id)).toBe("COMPLETED");
      expect(await status(middle.id)).toBe("COMPLETED");
      expect(await status(newest.id)).toBe("SUBMITTED");

      await run(now, only("auto-sign-off"), 2);
      expect(await status(newest.id)).toBe("COMPLETED");
    });
  });

  describe("the migration", () => {
    it("keeps the marks table private: row-level security on, no policies", async () => {
      const rows = await db().$queryRawUnsafe<{ relrowsecurity: boolean; policies: bigint }[]>(
        `SELECT c.relrowsecurity, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
         FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname = $1 AND c.relname = 'scheduled_job_marks'`,
        schema.name,
      );
      expect(rows).toEqual([{ relrowsecurity: true, policies: 0n }]);
    });

    it("rejects a mark for a rule that doesn't exist", async () => {
      const { id } = await job("REVIEW");
      await expect(db().scheduledJobMark.create({ data: { rule: "made.up", jobId: id } })).rejects.toThrow();
    });

    it("works without pg_cron: the timer function does nothing until the Vault secrets exist", async () => {
      await expect(db().$executeRawUnsafe(`SELECT "${schema.name}".run_scheduled_jobs()`)).resolves.toBeDefined();
    });
  });
});
