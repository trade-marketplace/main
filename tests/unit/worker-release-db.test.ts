// "Can't make it" (#147): handing a claimed job back, against a real Postgres. Skipped without TEST_DATABASE_URL.
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { Role } from "@/generated/prisma/client";
import { releaseJob } from "@/server/jobs/worker-release";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("handing a job back (database)", () => {
  const schema = useTestSchema(import.meta.filename);
  const NOW = new Date("2026-11-16T22:00:00Z"); // Tue 17 Nov, 11am in New Zealand
  afterEach(async () => { await schema.db.job.updateMany({ where: { status: "ASSIGNED" }, data: { status: "CANCELLED", workerId: null, bookedDate: null, bookedTime: null } }); });
  async function person(role: Role) {
    const id = randomUUID();
    await schema.db.$executeRaw`INSERT INTO auth.users(id) VALUES(${id}::uuid)`;
    await schema.db.profile.create({ data: { id, role, firstName: role === "TRADIE" ? "Jack" : "Sarah", email: `${id}@example.test` } });
    return id;
  }
  async function claimed(booked?: string) {
    const customerId = await person("CUSTOMER"), workerId = await person("TRADIE"), office = await person("ADMIN");
    const job = await schema.db.job.create({ data: { customerId, category: "OTHER", title: "Hang a door", description: "Hang a new interior door.", addressLine1: "147 Test Street", suburb: "Windsor", city: "Invercargill", status: "ASSIGNED", workerId, priceCents: 12_000, anyTime: true,
      ...(booked ? { bookedDate: new Date(`${booked}T00:00:00Z`), bookedTime: "MORNING" as const } : {}) } });
    return { job, customerId, workerId, office, viewer: { userId: workerId, role: "TRADIE" as const } };
  }
  const reasons = { reason: "Sick or hurt" as const };

  it("hands it back: back on the board, booking cleared, customer told, reason audited", async () => {
    const { job, customerId, office, viewer } = await claimed("2026-11-25");
    expect((await releaseJob(schema.db, viewer, job.id, { ...reasons, note: "Flu" }, NOW)).result).toEqual({ status: "released" });
    expect(await schema.db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "BOOKABLE", workerId: null, bookedDate: null, bookedTime: null });
    expect(await schema.db.notification.count({ where: { userId: customerId, type: "job.released" } })).toBe(1);
    expect(await schema.db.notification.count({ where: { userId: office, type: "job.release_flagged" } })).toBe(0);
    expect(await schema.db.auditLog.findFirst({ where: { recordId: job.id, action: "job.released" } })).toMatchObject({ reason: "Sick or hurt: Flu" });
  });

  it("tells the office when it was booked for tomorrow", async () => {
    const { job, office, viewer } = await claimed("2026-11-18");
    expect((await releaseJob(schema.db, viewer, job.id, reasons, NOW)).result).toEqual({ status: "released" });
    expect(await schema.db.notification.count({ where: { userId: office, type: "job.release_flagged" } })).toBe(1);
  });

  it("tells the office on the second hand-back in 30 days", async () => {
    const first = await claimed(), second = await claimed();
    await schema.db.job.update({ where: { id: second.job.id }, data: { workerId: first.workerId } });
    expect((await releaseJob(schema.db, first.viewer, first.job.id, reasons, NOW)).result).toEqual({ status: "released" });
    expect((await releaseJob(schema.db, first.viewer, second.job.id, reasons, NOW)).result).toEqual({ status: "released" });
    expect(await schema.db.notification.count({ where: { userId: second.office, type: "job.release_flagged" } })).toBe(1);
  });

  it("clears the unsent finish-up draft and its materials spend, and returns its files to tidy", async () => {
    const { job, workerId, viewer } = await claimed();
    await schema.db.completionEvidence.create({ data: { jobId: job.id, workerId, cocNumber: "123", photos: { create: [{ path: `evidence/${job.id}/a.webp` }] } } });
    await schema.db.jobMaterials.create({ data: { jobId: job.id, budgetCents: 5000, spentCents: 4000, spentAt: NOW, receiptPath: `receipts/${workerId}/${"a".repeat(32)}.pdf` } });
    const { result, orphanPaths } = await releaseJob(schema.db, viewer, job.id, reasons, NOW);
    expect(result).toEqual({ status: "released" });
    expect(orphanPaths.photos).toEqual([`evidence/${job.id}/a.webp`]);
    expect(orphanPaths.documents).toHaveLength(1);
    expect(await schema.db.completionEvidence.count({ where: { jobId: job.id } })).toBe(0);
    expect(await schema.db.jobMaterials.findUniqueOrThrow({ where: { jobId: job.id } })).toMatchObject({ budgetCents: 5000, spentCents: null, receiptPath: null });
  });

  it("refuses while extra work is waiting, and changes nothing", async () => {
    const { job, workerId, viewer } = await claimed("2026-11-25");
    await schema.db.variation.create({ data: { jobId: job.id, requestedById: workerId, description: "Another door to hang", requestedMinutes: 30 } });
    expect((await releaseJob(schema.db, viewer, job.id, reasons, NOW)).result).toEqual({ status: "extra-work" });
    expect(await schema.db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "ASSIGNED", workerId, bookedTime: "MORNING" });
  });

  it("refuses another tradie, a missing reason and a job that isn't claimed", async () => {
    const { job } = await claimed(), stranger = { userId: await person("TRADIE"), role: "TRADIE" as const };
    expect((await releaseJob(schema.db, stranger, job.id, reasons, NOW)).result).toEqual({ status: "forbidden" });
    expect((await releaseJob(schema.db, { userId: job.workerId!, role: "TRADIE" }, job.id, {}, NOW)).result).toMatchObject({ status: "invalid" });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "SUBMITTED" } });
    expect((await releaseJob(schema.db, { userId: job.workerId!, role: "TRADIE" }, job.id, reasons, NOW)).result).toEqual({ status: "changed" });
  });

  it("hands back once when sent twice at the same moment", async () => {
    const { job, customerId, viewer } = await claimed();
    const results = await Promise.all([releaseJob(schema.db, viewer, job.id, reasons, NOW), releaseJob(schema.db, viewer, job.id, reasons, NOW)]);
    expect(results.map(r => r.result.status).sort()).toEqual(["forbidden", "released"]);
    expect(await schema.db.notification.count({ where: { userId: customerId, type: "job.released" } })).toBe(1);
  });
});
