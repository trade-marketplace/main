import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { JobStatus, Role } from "@/generated/prisma/client";
import { parseQueueQuery } from "@/lib/office-queues";
import { readOfficeQueues, readOfficeQueueStats } from "@/server/office/queues";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("office queues with real PostgreSQL", () => {
  const schema = useTestSchema(import.meta.filename);
  const NOW = new Date(Date.now() + 100 * 3_600_000);
  const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);
  async function person(role: Role, name: string = role) {
    const userId = randomUUID(), email = `${userId}@example.test`;
    await schema.db.$executeRaw`INSERT INTO auth.users(id,email) VALUES(${userId}::uuid,${email})`;
    await schema.db.profile.create({ data: { id: userId, role, email, firstName: name, phone: "+64211234567" } });
    return { userId, role, email };
  }
  async function fixture(status: JobStatus = "REVIEW", hours = 26) {
    const customer = await person("CUSTOMER", "Sarah"), worker = await person("TRADIE", "Jack"), office = await person("ADMIN");
    const claimed = ["ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW"].includes(status);
    const job = await schema.db.job.create({ data: { customerId: customer.userId, workerId: claimed ? worker.userId : null,
      category: "OTHER", title: `Queue fixture ${randomUUID().slice(0, 8)}`, description: "Hang a door.", addressLine1: "1 Private Fixture Street", suburb: "Windsor", city: "Invercargill",
      status, priceCents: ["REVIEW", "QUOTE_BOUNTY"].includes(status) ? null : 12000 } });
    // Simulate the latest entry at a controlled time after the real insertion history. No mutable updatedAt clock.
    await schema.db.jobStatusHistory.create({ data: { jobId: job.id, fromStatus: status === "BOOKABLE" ? "ASSIGNED" : "PRICED", toStatus: status, createdAt: ago(hours) } });
    return { customer, worker, office, job };
  }
  async function clearJobs() {
    // Independent examples keep counts unambiguous. These fixtures have no paid payouts or submitted evidence.
    await schema.db.problemReport.deleteMany();
    await schema.db.variation.deleteMany();
    await schema.db.job.deleteMany();
  }

  it("keeps the To price count, rows and oldest-first urgency aligned after message/activity updates and re-entry", async () => {
    const old = await fixture("REVIEW", 26), recent = await fixture("REVIEW", 3), quoted = await fixture("QUOTE_BOUNTY", 10);
    await schema.db.job.update({ where: { id: old.job.id }, data: { updatedAt: NOW } });
    await schema.db.estimate.create({ data: { jobId: old.job.id, workerId: old.worker.userId, minutes: 120, materialsCents: 1234 } });
    const data = await readOfficeQueues(schema.db, old.office, parseQueueQuery({}), NOW);
    expect(data.kpis.price.count).toBe(3);
    expect(data.rows.map(row => row.jobId)).toEqual([old.job.id, quoted.job.id, recent.job.id]);
    expect(data.rows[0]).toMatchObject({ waiting: "26h", overdue: true, action: "Price it", href: `/admin/jobs/${old.job.id}/price` });
    expect(data.rows.at(-1)).toMatchObject({ waiting: "3h", overdue: false });
    expect(JSON.stringify(data)).not.toMatch(/Private Fixture|@example.test|211234567|marginCents|accessNotes/);
    await clearJobs();
  });

  it("counts extra-work tasks per variation and excludes requests on closed jobs", async () => {
    const f = await fixture("ASSIGNED"), closed = await fixture("ASSIGNED");
    for (const [job, worker, descriptions] of [[f.job, f.worker, ["First extra task", "Second extra task"]], [closed.job, closed.worker, ["Closed extra task"]]] as const) {
      for (const description of descriptions) await schema.db.variation.create({ data: { jobId: job.id, requestedById: worker.userId, description, requestedMinutes: 30 } });
    }
    await schema.db.job.update({ where: { id: closed.job.id }, data: { status: "CANCELLED" } });
    const data = await readOfficeQueues(schema.db, f.office, parseQueueQuery({ tab: "extra" }), NOW);
    expect(data.kpis.extra.count).toBe(2); expect(data.total).toBe(2);
    expect(data.rows.map(row => row.context)).toEqual(["First extra task", "Second extra task"]);
    expect(new Set(data.rows.map(row => row.id)).size).toBe(2);
    expect(data.rows.every(row => row.jobId === f.job.id && row.action === "Price it" && row.href === `/admin/variations/${row.id}?from=%2Fadmin%3Ftab%3Dextra`)).toBe(true);
    await clearJobs();
  });

  it("resets unclaimed age on a recent BOOKABLE re-entry and ignores a retained/closed assignment", async () => {
    const old = await fixture("BOOKABLE", 49), oldest = await fixture("BOOKABLE", 55), recent = await fixture("BOOKABLE", 1), cancelled = await fixture("CANCELLED", 80);
    for (const [job, suburb] of [[old.job, "Waverley"], [oldest.job, "Richmond"], [recent.job, "Otatara"], [cancelled.job, "Bluff"]] as const) await schema.db.job.update({ where: { id: job.id }, data: { suburb } });
    const data = await readOfficeQueues(schema.db, old.office, parseQueueQuery({ tab: "unclaimed" }), NOW);
    expect(data.kpis.unclaimed).toMatchObject({ count: 2, detail: "Richmond", oldestAt: ago(55).toISOString(), overdue: true });
    expect(data.rows.map(row => row.jobId)).toEqual([oldest.job.id, old.job.id]);
    expect(data.rows).not.toContainEqual(expect.objectContaining({ jobId: recent.job.id }));
    expect(data.rows).not.toContainEqual(expect.objectContaining({ jobId: cancelled.job.id }));
    await clearJobs();
  });

  it("searches all statuses by job number, customer/tradie name, email and formatted phone without exposing contact fields", async () => {
    const f = await fixture("ASSIGNED", 2);
    for (const q of [`TM-${f.job.jobNumber}`, f.customer.email, "Sarah", "Jack", "021 123 4567"]) {
      const data = await readOfficeQueues(schema.db, f.office, parseQueueQuery({ q }), NOW);
      expect(data.rows.map(row => row.jobId), q).toContain(f.job.id);
      expect(JSON.stringify(data)).not.toMatch(/@example.test|211234567|Private Fixture/);
    }
    expect((await readOfficeQueues(schema.db, f.office, parseQueueQuery({ q: "no-match-canary-167" }), NOW)).total).toBe(0);
    for (const actor of [f.customer, f.worker]) await expect(readOfficeQueueStats(schema.db, actor, NOW)).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    await clearJobs();
  });

  it("shows only active cancellation requests and binds the displayed reason to the current request", async () => {
    const f = await fixture("BOOKABLE", 101); await fixture("CANCELLED", 101);
    await schema.db.auditLog.create({ data: { actorId: f.customer.userId, actorRole: "CUSTOMER", action: "job.cancel_requested", recordType: "jobs", recordId: f.job.id, reason: "Old request reason" } });
    await schema.db.job.update({ where: { id: f.job.id }, data: { status: "CANCEL_REVIEW" } });
    const now = new Date(Date.now() + 3 * 3_600_000);
    const data = await readOfficeQueues(schema.db, f.office, parseQueueQuery({ tab: "cancel" }), now);
    expect(data.kpis.cancel.count).toBe(1); expect(data.rows[0].context).toBe("—");
    await schema.db.auditLog.create({ data: { actorId: f.customer.userId, actorRole: "CUSTOMER", action: "job.cancel_requested", recordType: "jobs", recordId: f.job.id, reason: "Current request reason" } });
    expect((await readOfficeQueues(schema.db, f.office, parseQueueQuery({ tab: "cancel" }), now)).rows[0].context).toBe("Current request reason");
    await clearJobs();
  });

  it("keeps row/KPI overdue flags aligned for a SUBMITTED office override with missing evidence", async () => {
    const f = await fixture("SUBMITTED", 60);
    const data = await readOfficeQueues(schema.db, f.office, parseQueueQuery({ tab: "signoff" }), NOW);
    expect(data.kpis.signoff).toMatchObject({ count: 1, overdue: true, detail: "0 auto-release today" });
    expect(data.rows[0]).toMatchObject({ waiting: "60h", overdue: true, context: "—" });
    await clearJobs();
  });

  it("uses submitted evidence/settings for sign-off, pauses auto-release for open problems, and links cases without treating them as cancellations", async () => {
    const override = await fixture("SUBMITTED", 101);
    const f = await fixture("SUBMITTED", 101);
    await schema.db.jobMaterials.create({ data: { jobId: f.job.id, budgetCents: 0, spentCents: 0, spentAt: new Date() } });
    await schema.db.completionEvidence.create({ data: { jobId: f.job.id, workerId: f.worker.userId, notes: "Door hung." } });
    await schema.db.completionEvidencePhoto.create({ data: { jobId: f.job.id, path: `evidence/${f.job.id}/1.jpg` } });
    const sent = await schema.db.completionEvidence.update({ where: { jobId: f.job.id }, data: { declaration: "I did this work.", declaredAt: new Date(), submittedAt: new Date() } });
    const now = new Date(sent.submittedAt!.getTime() + 10 * 3_600_000);
    await schema.db.settings.update({ where: { id: 1 }, data: { autoReleaseHours: 12 } });
    let data = await readOfficeQueues(schema.db, f.office, parseQueueQuery({ tab: "signoff" }), now);
    expect(data.rows.map(row => row.jobId)).toEqual([override.job.id, f.job.id]);
    expect(data.rows[0]).toMatchObject({ overdue: false, context: "—" });
    expect(data.rows[1]).toMatchObject({ waiting: "10h", overdue: false, href: `/admin/signoff/${f.job.id}` });
    const report = await schema.db.problemReport.create({ data: { jobId: f.job.id, reportedById: f.customer.userId, topic: "Work not finished", details: "The latch needs checking." } });
    data = await readOfficeQueues(schema.db, f.office, parseQueueQuery({ tab: "signoff" }), now);
    expect(data.rows.find(row => row.jobId === f.job.id)).toMatchObject({ context: "Problems", overdue: false });
    expect(data.kpis.signoff.detail).toBe("0 auto-release today"); expect(data.kpis.cancel.count).toBe(0);
    expect(data.problems[0]).toMatchObject({ id: report.id });
    const problemHref = new URL(data.problems[0].href, "https://app.test");
    expect(problemHref.pathname).toBe(`/admin/jobs/${f.job.id}`); expect(problemHref.searchParams.get("problem")).toBe(report.id); expect(problemHref.searchParams.get("from")).toBe("problems");
  });
});
