import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { JobStatus, Role } from "@/generated/prisma/client";
import { loadMyQuotes, loadMyWork } from "@/server/workers/my-work";
import { priceJob } from "@/server/pricing/price-job";
import { priceVariation } from "@/server/variations/price";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("My work owner-scoped PostgreSQL reads", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: Role = "TRADIE") {
    const userId = randomUUID(); await schema.db.$executeRaw`INSERT INTO auth.users(id) VALUES(${userId}::uuid)`;
    await schema.db.profile.create({ data: { id: userId, role, firstName: "Fixture", email: `${userId}@example.test` } });
    return { userId, role };
  }
  async function job(customerId: string, workerId: string | null, status: JobStatus = "ASSIGNED", title = "My work fixture") {
    const row = await schema.db.job.create({ data: { customerId, category: "OTHER", title, description: "Private description", addressLine1: "Private street", suburb: "Windsor", city: "Invercargill", anyTime: true } });
    expect((await priceJob(schema.db, { jobId: row.id, minutes: 120, materialsCents: 5000 })).ok).toBe(true);
    return schema.db.job.update({ where: { id: row.id }, data: { status, workerId } });
  }
  it("returns only own assigned statuses, with canonical worker pay and true column counts", async () => {
    const me = await person(), other = await person(), customer = await person("CUSTOMER");
    const toBook = await job(customer.userId, me.userId);
    const onNow = await job(customer.userId, me.userId); await schema.db.job.update({ where: { id: onNow.id }, data: { bookedDate: new Date("2026-11-12"), bookedTime: "MORNING" } });
    await job(customer.userId, me.userId, "CANCEL_REVIEW"); await job(customer.userId, me.userId, "SUBMITTED");
    const foreign = await job(customer.userId, other.userId); await job(customer.userId, null, "BOOKABLE"); await job(customer.userId, me.userId, "CANCELLED");
    const data = await loadMyWork(schema.db, me);
    expect(data.counts).toEqual({ "to-book": 1, "on-now": 2, "waiting-sign-off": 1, done: 0 }); expect(data.jobsOn).toBe(3);
    const pricing = await schema.db.jobPricing.findUniqueOrThrow({ where: { jobId: toBook.id } });
    expect(data.columns["to-book"][0]).toMatchObject({ id: toBook.id, earnCents: pricing.workerGrossCents + pricing.holidayPayCents });
    expect(data.columns["to-book"][0].claimedAt).not.toBeNull();
    expect(JSON.stringify(data)).not.toContain(foreign.id);
    expect(JSON.stringify(data)).not.toMatch(/customerId|workerId|priceCents|marginCents|materialsCents|addressLine|Private street|pricing/);
    await expect(loadMyWork(schema.db, customer)).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });
  it("returns the newest five Done jobs while preserving their total and exact payout status", async () => {
    const me = await person(), customer = await person("CUSTOMER"); const ids: string[] = [];
    for (let index = 0; index < 8; index++) {
      const row = await job(customer.userId, me.userId, "COMPLETED", `Done ${index}`); ids.push(row.id);
      await schema.db.jobStatusHistory.updateMany({ where: { jobId: row.id, toStatus: "COMPLETED" }, data: { createdAt: new Date(Date.UTC(2026, 9, 20 + index)) } });
      if (index >= 5) await schema.db.payout.create({ data: { jobId: row.id, workerId: me.userId, minutes: 120, rateCents: 3800, grossCents: 7600, holidayPayCents: 608,
        status: index === 7 ? "PAID" : index === 6 ? "EXPORTED" : "QUEUED", exportedAt: index >= 6 ? new Date() : null, paidAt: index === 7 ? new Date() : null } });
    }
    const data = await loadMyWork(schema.db, me);
    expect(data.counts.done).toBe(8); expect(data.columns.done.map(row => row.id)).toEqual(ids.slice(3).reverse());
    expect(data.columns.done.map(row => row.payout)).toEqual(["Paid", "Queued", "Queued", "Queued", "Queued"]);
  });
  it("reads the configured clock, actual evidence time, customer holds and priced extra work", async () => {
    const me = await person(), customer = await person("CUSTOMER"), office = await person("ADMIN");
    await schema.db.settings.upsert({ where: { id: 1 }, create: { id: 1, autoReleaseHours: 24 }, update: { autoReleaseHours: 24 } });
    const row = await job(customer.userId, me.userId);
    await schema.db.jobMaterials.create({ data: { jobId: row.id, budgetCents: 5000, spentCents: 0, spentAt: new Date() } });
    await schema.db.completionEvidence.create({ data: { jobId: row.id, workerId: me.userId, notes: "Finished work" } });
    await schema.db.completionEvidencePhoto.create({ data: { jobId: row.id, path: `evidence/${row.id}/fixture.webp` } });
    const sentAt = new Date("2026-11-10T00:00:00Z");
    const sent = await schema.db.completionEvidence.update({ where: { jobId: row.id }, data: { declaration: "I did this work.", declaredAt: sentAt, submittedAt: sentAt } });
    await schema.db.job.update({ where: { id: row.id }, data: { status: "SUBMITTED" } });
    await schema.db.problemReport.create({ data: { jobId: row.id, reportedById: customer.userId, topic: "Work not finished", details: "Please check this work" } });
    const extra = await job(customer.userId, me.userId);
    await schema.db.job.update({ where: { id: extra.id }, data: { bookedDate: new Date("2026-11-12"), bookedTime: "MORNING" } });
    const ask = await schema.db.variation.create({ data: { jobId: extra.id, requestedById: me.userId, description: "Extra fixture", requestedMinutes: 30 } });
    expect(await priceVariation(schema.db, office, ask.id, 0)).toMatchObject({ ok: true });
    const data = await loadMyWork(schema.db, me);
    expect(data.autoReleaseHours).toBe(24); expect(data.columns["waiting-sign-off"][0]).toMatchObject({ submittedAt: sent.submittedAt!.toISOString(), openProblems: 1 });
    expect(data.columns["on-now"][0].openExtraWork).toBe(1);
  });
  it("keeps only own quote history, redacts unassigned contacts and links only existing readable jobs", async () => {
    const me = await person(), other = await person(), customer = await person("CUSTOMER");
    const waiting = await job(customer.userId, null, "REVIEW", "Call 0211234567 about work");
    const priced = await job(customer.userId, null, "PRICED");
    const taken = await job(customer.userId, me.userId);
    const lost = await job(customer.userId, other.userId);
    for (const row of [waiting, priced, taken, lost]) await schema.db.estimate.create({ data: { jobId: row.id, workerId: me.userId, minutes: 90, note: "Private quote note" } });
    const foreign = await schema.db.estimate.create({ data: { jobId: waiting.id, workerId: other.userId, minutes: 120 } });
    const data = await loadMyQuotes(schema.db, me);
    expect(data.total).toBe(4);
    for (const [row, outcome, canOpen] of [[waiting, "Waiting", true], [priced, "Priced", false], [taken, "Taken by you", true], [lost, "Not taken", false]] as const) expect(data.rows.find(item => item.jobId === row.id)).toMatchObject({ outcome, canOpen });
    expect(JSON.stringify(data)).not.toMatch(/0211234567|Private quote note|customerId|workerId|priceCents|materialsCents|minutes|margin/); expect(JSON.stringify(data)).not.toContain(foreign.id);
    await expect(loadMyQuotes(schema.db, customer)).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });
  it("caps quote rows at fifty newest while counting the full owner history", async () => {
    const me = await person(), customer = await person("CUSTOMER"); const ids: string[] = [];
    for (let index = 0; index < 52; index++) {
      const row = await schema.db.job.create({ data: { customerId: customer.userId, category: "OTHER", title: `Quote ${index}`, description: "Fixture", addressLine1: "Private", suburb: "Windsor", city: "Invercargill" } });
      const quote = await schema.db.estimate.create({ data: { jobId: row.id, workerId: me.userId, minutes: 90, createdAt: new Date(Date.UTC(2026, 9, 1, index)) } }); ids.push(quote.id);
    }
    const data = await loadMyQuotes(schema.db, me);
    expect(data.total).toBe(52); expect(data.rows).toHaveLength(50); expect(data.rows.map(row => row.id)).toEqual(ids.slice(2).reverse());
  });
});
