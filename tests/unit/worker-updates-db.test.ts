import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Prisma, Role, JobStatus } from "@/generated/prisma/client";
import { sendJobUpdate } from "@/server/jobs/worker-updates";
import { loadWorkspace } from "@/server/jobs/worker-workspace";
import { calculatePayout } from "@/server/payouts/calculate";
import { loadEarnings } from "@/server/earnings/load";
import { priceJob } from "@/server/pricing/price-job";
import { notificationId } from "@/server/notifications/notify";
import { inboxItem } from "@/server/notifications/inbox";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";
describe.skipIf(!testDatabaseUrl)("worker preset transactions and workspace reads", () => {
  const schema = useTestSchema(import.meta.filename), allow = { consume: vi.fn(async () => ({ allowed: true as const })) };
  async function person(role: Role) {
    const id = randomUUID(), email = `${id}@example.test`;
    await schema.db.$executeRaw`INSERT INTO auth.users(id,email) VALUES(${id}::uuid,${email})`;
    return schema.db.profile.create({ data: { id, email, role, firstName: "Sarah", lastName: "Thompson", phone: "+64215550192" } });
  }
  async function fixture() {
    const customer = await person("CUSTOMER"), worker = await person("TRADIE"), office = await person("ADMIN"), office2 = await person("ADMIN");
    const job = await schema.db.job.create({ data: { customerId: customer.id, category: "OTHER", title: "Workspace job", description: "Move a couch.", addressLine1: "149 Private Street", suburb: "Windsor", city: "Invercargill", anyTime: true } });
    await priceJob(schema.db, { jobId: job.id, minutes: 120, materialsCents: 8500, pricedById: office.id });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "ASSIGNED", workerId: worker.id } });
    return { job: (await schema.db.job.findUniqueOrThrow({ where: { id: job.id } })), customer, viewer: { userId: worker.id, role: "TRADIE" as const }, office, office2 };
  }
  async function extra(jobId: string, workerId: string, status: "REQUESTED" | "PRICED" | "APPROVED" | "DECLINED", minutes: number) {
    const row = await schema.db.variation.create({ data: { jobId, requestedById: workerId, description: "Extra moving", requestedMinutes: minutes } });
    if (status !== "REQUESTED") await schema.db.variation.update({ where: { id: row.id }, data: { status: "PRICED", minutes, materialsCents: 0, workerGrossCents: 0, holidayPayCents: 0, onCostCents: 0, marginCents: 0, gstCents: 0, priceCents: 0 } });
    if (status === "APPROVED" || status === "DECLINED") await schema.db.variation.update({ where: { id: row.id }, data: { status } });
  }
  it("matches Earnings for approved extra work and ignores requested, priced and declined minutes", async () => {
    const { job, viewer } = await fixture();
    await extra(job.id, viewer.userId, "APPROVED", 30); await extra(job.id, viewer.userId, "DECLINED", 90); await extra(job.id, viewer.userId, "PRICED", 60); await extra(job.id, viewer.userId, "REQUESTED", 120);
    const pricing = await schema.db.jobPricing.findUniqueOrThrow({ where: { jobId: job.id } });
    const total = calculatePayout({ jobMinutes: pricing.minutes, workerRateCents: pricing.workerRateCents, holidayPayBps: pricing.holidayPayBps, approvedExtraMinutes: [30] }).totalCents;
    const workspace = await loadWorkspace(schema.db, viewer, job.id);
    expect(workspace).toMatchObject({ earnCents: total, extraWorkOpen: true });
    const earnings = await loadEarnings(schema.db, viewer.userId);
    expect(earnings.view.waiting.items.find(item => item.id === job.id)?.totalCents).toBe(total);
  });
  it.each(["on-my-way", "running-late", "customer-not-home"] as const)("%s commits one actor audit and the exact notification contract to the right recipients", async kind => {
    const { job, customer, viewer } = await fixture();
    expect(await sendJobUpdate(schema.db, viewer, job.id, kind, kind === "running-late" ? 30 : undefined, allow)).toEqual({ status: "sent" });
    const action = kind === "on-my-way" ? "job.on_my_way" : kind === "running-late" ? "job.running_late" : "job.customer_not_home";
    const audit = await schema.db.auditLog.findMany({ where: { recordId: job.id, action } }); expect(audit).toHaveLength(1); expect(audit[0]).toMatchObject({ actorId: viewer.userId, actorRole: "TRADIE" });
    const notices = await schema.db.notification.findMany({ where: { type: action, payload: { path: ["jobId"], equals: job.id } } });
    const people = kind === "customer-not-home" ? (await schema.db.profile.findMany({ where: { role: "ADMIN" } })).map(person => person.id) : [customer.id];
    expect(notices.map(row => row.userId).sort()).toEqual(people.sort());
    for (const notice of notices) { expect(notice.id).toBe(notificationId(`${audit[0].action}:${audit[0].id}`, notice.userId)); expect(notice.payload).toEqual({ jobId: job.id, jobNumber: job.jobNumber, ...(kind === "running-late" ? { lateMinutes: 30 } : {}) }); expect(inboxItem(notice).href).toBe(kind === "customer-not-home" ? `/admin/jobs/${job.id}` : `/jobs/${job.id}`); }
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: job.id } })).updatedAt.getTime()).toBeGreaterThan(job.updatedAt.getTime());
    expect(allow.consume).toHaveBeenCalledWith("message", viewer.userId);
  });
  it("serializes concurrent repeats; a duplicate writes nothing, while a later update can send again", async () => {
    const { job, viewer } = await fixture();
    expect(await Promise.all([sendJobUpdate(schema.db, viewer, job.id, "running-late", 15, allow), sendJobUpdate(schema.db, viewer, job.id, "running-late", 60, allow)])).toEqual([{ status: "sent" }, { status: "sent" }]);
    expect(await schema.db.auditLog.count({ where: { recordId: job.id, action: "job.running_late" } })).toBe(1);
    const previous = (await schema.db.job.findUniqueOrThrow({ where: { id: job.id } })).updatedAt;
    await sendJobUpdate(schema.db, viewer, job.id, "running-late", 30, allow);
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: job.id } })).updatedAt).toEqual(previous);
    await sendJobUpdate(schema.db, viewer, job.id, "running-late", 30, { ...allow, now: () => new Date(Date.now() + 121_000) });
    expect(await schema.db.auditLog.count({ where: { recordId: job.id, action: "job.running_late" } })).toBe(2);
  });
  it("refuses foreign, missing, malformed and freshly changed roles without writing activity", async () => {
    const { job, viewer, customer } = await fixture(), other = await person("TRADIE");
    for (const [who, id] of [[{ userId: other.id, role: "TRADIE" as const }, job.id], [viewer, randomUUID()], [viewer, "invalid"], [{ userId: customer.id, role: "CUSTOMER" as const }, job.id]] as const) expect(await sendJobUpdate(schema.db, who, id, "on-my-way", undefined, allow)).toEqual({ status: "forbidden" });
    await schema.db.profile.update({ where: { id: viewer.userId }, data: { role: "CUSTOMER" } });
    expect(await sendJobUpdate(schema.db, viewer, job.id, "on-my-way", undefined, allow)).toEqual({ status: "forbidden" });
    expect(await schema.db.auditLog.count({ where: { recordId: job.id, action: "job.on_my_way" } })).toBe(0);
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: job.id } })).updatedAt).toEqual(job.updatedAt);
  });
  it.each(["BOOKABLE", "CANCEL_REVIEW"] as JobStatus[])("refuses %s jobs without writes", async status => {
    const { job, viewer } = await fixture(); await schema.db.job.update({ where: { id: job.id }, data: { status } });
    expect(await sendJobUpdate(schema.db, viewer, job.id, "on-my-way", undefined, allow)).toEqual({ status: "forbidden" });
    expect(await schema.db.auditLog.count({ where: { recordId: job.id, action: "job.on_my_way" } })).toBe(0);
  });
  it("refuses invalid update kinds and every unsupported delay; all three valid delays work", async () => {
    const { job, viewer } = await fixture();
    for (const delay of [undefined, null, 0, 14, 16, 90, "30", {}, 30.5]) expect(await sendJobUpdate(schema.db, viewer, job.id, "running-late", delay, allow)).toEqual({ status: "invalid" });
    expect(await sendJobUpdate(schema.db, viewer, job.id, "toString", undefined, allow)).toEqual({ status: "invalid" });
    for (const delay of [15, 30, 60]) expect(await sendJobUpdate(schema.db, viewer, job.id, "running-late", delay, allow)).toEqual({ status: "sent" });
    expect(await schema.db.auditLog.count({ where: { recordId: job.id, action: "job.running_late" } })).toBe(1);
  });
  it("returns the limiter refusal without job/audit/notification writes", async () => {
    const { job, viewer } = await fixture();
    expect(await sendJobUpdate(schema.db, viewer, job.id, "on-my-way", undefined, { consume: async () => ({ allowed: false, retryAfter: 86 }) })).toEqual({ status: "try-later", retryAfter: 86 });
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: job.id } })).updatedAt).toEqual(job.updatedAt);
    expect(await schema.db.auditLog.count({ where: { recordId: job.id, action: "job.on_my_way" } })).toBe(0);
  });
  it("rolls back the audit and activity if notification persistence fails", async () => {
    const { job, viewer } = await fixture();
    const broken = new Proxy(schema.db, { get(target, key) { if (key !== "$transaction") return Reflect.get(target, key, target); return (run: (tx: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction(tx => run(new Proxy(tx, { get(client, model) { if (model !== "notification") return Reflect.get(client, model, client); return { upsert: () => { throw Error("fixture unavailable"); } }; } }))); } });
    expect(await sendJobUpdate(broken, viewer, job.id, "on-my-way", undefined, allow)).toEqual({ status: "unavailable" });
    expect(await schema.db.auditLog.count({ where: { recordId: job.id, action: "job.on_my_way" } })).toBe(0);
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: job.id } })).updatedAt).toEqual(job.updatedAt);
  });
  it("only projects the assignee and canonical earnings/materials; hides raw pricing, other quotes and contact ids", async () => {
    const { job, viewer, customer, office } = await fixture(), other = await person("TRADIE");
    const result = await loadWorkspace(schema.db, viewer, job.id); expect(result).toMatchObject({ budgetCents: 8500, address: "149 Private Street, Windsor, Invercargill", customer: { firstName: "Sarah", lastInitial: "T", phone: "+64215550192" }, extraWorkOpen: false });
    const pricing = await schema.db.jobPricing.findUniqueOrThrow({ where: { jobId: job.id } }); expect(result?.earnCents).toBe(pricing.workerGrossCents + pricing.holidayPayCents);
    expect(JSON.stringify(result)).not.toMatch(/priceCents|margin|workerRate|estimate|customerId|@example/);
    for (const who of [{ userId: other.id, role: "TRADIE" as const }, { userId: customer.id, role: "CUSTOMER" as const }, { userId: office.id, role: "ADMIN" as const }]) expect(await loadWorkspace(schema.db, who, job.id)).toBeNull();
    expect(await loadWorkspace(schema.db, viewer, randomUUID())).toBeNull(); expect(await loadWorkspace(schema.db, viewer, "invalid")).toBeNull();
    await schema.db.jobMaterials.create({ data: { jobId: job.id, budgetCents: 4200 } }); expect((await loadWorkspace(schema.db, viewer, job.id))?.budgetCents).toBe(4200);
  });
  it("finds requested extra work without changing status or pricing", async () => {
    const { job, viewer } = await fixture();
    await schema.db.variation.create({ data: { jobId: job.id, requestedById: viewer.userId, description: "Extra moving", requestedMinutes: 60, requestedMaterialsCents: 0 } });
    expect((await loadWorkspace(schema.db, viewer, job.id))?.extraWorkOpen).toBe(true);
  });
  it("reads submitted/completed work and uses the settings window from the real evidence timestamp", async () => {
    const { job, viewer } = await fixture();
    await extra(job.id, viewer.userId, "APPROVED", 30);
    await schema.db.jobMaterials.create({ data: { jobId: job.id, budgetCents: 8500, spentCents: 0, spentAt: new Date() } });
    await schema.db.completionEvidence.create({ data: { jobId: job.id, workerId: viewer.userId, notes: "Done", declaration: "The work is complete.", declaredAt: new Date() } });
    await schema.db.completionEvidencePhoto.create({ data: { jobId: job.id, path: `evidence/${job.id}/test.webp`, position: 0 } });
    const evidence = await schema.db.completionEvidence.update({ where: { jobId: job.id }, data: { submittedAt: new Date() } });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "SUBMITTED" } });
    await schema.db.settings.update({ where: { id: 1 }, data: { autoReleaseHours: 72 } });
    const result = await loadWorkspace(schema.db, viewer, job.id);
    expect(result).toMatchObject({ status: "SUBMITTED", autoReleaseHours: 72, signOffDeadline: new Date(evidence.submittedAt!.getTime() + 72 * 3_600_000).toISOString() });
    expect(await sendJobUpdate(schema.db, viewer, job.id, "on-my-way", undefined, allow)).toEqual({ status: "forbidden" });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "COMPLETED" } });
    const pricing = await schema.db.jobPricing.findUniqueOrThrow({ where: { jobId: job.id } });
    const predicted = calculatePayout({ jobMinutes: pricing.minutes, workerRateCents: pricing.workerRateCents, holidayPayBps: pricing.holidayPayBps, approvedExtraMinutes: [30] }).totalCents;
    expect(result?.earnCents).toBe(predicted);
    expect((await loadWorkspace(schema.db, viewer, job.id))?.earnCents).toBe(predicted);
    await schema.db.payout.create({ data: { jobId: job.id, workerId: viewer.userId, minutes: 180, rateCents: 3800, grossCents: 11400, holidayPayCents: 912, status: "QUEUED" } });
    expect(await loadWorkspace(schema.db, viewer, job.id)).toMatchObject({ status: "COMPLETED", earnCents: 12312, payout: "QUEUED" });
    expect(await sendJobUpdate(schema.db, viewer, job.id, "on-my-way", undefined, allow)).toEqual({ status: "forbidden" });
    await schema.db.settings.update({ where: { id: 1 }, data: { autoReleaseHours: 48 } });
  });

});
