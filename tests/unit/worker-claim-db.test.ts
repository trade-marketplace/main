import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Prisma, Role } from "@/generated/prisma/client";
import { claimWorkerJob } from "@/server/jobs/worker-claim-command";
import { loadWorkerClaim } from "@/server/jobs/worker-claim-reader";
import { priceJob } from "@/server/pricing/price-job";
import { pointBalance } from "@/server/points/ledger";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";
describe.skipIf(!testDatabaseUrl)("worker claim transaction", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: Role) {
    const id = randomUUID(), email = `${id}@example.test`;
    await schema.db.$executeRaw`INSERT INTO auth.users(id,email) VALUES(${id}::uuid,${email})`;
    return schema.db.profile.create({ data: { id, email, role, firstName: role === "CUSTOMER" ? "Sarah" : "Jack", emailVerifiedAt: new Date() } });
  }
  async function fixture() {
    const customer = await person("CUSTOMER"), worker = await person("TRADIE"), office = await person("ADMIN");
    await schema.db.workerProfile.create({ data: { userId: worker.id, identityCheckedAt: new Date(), identityCheckedById: office.id, baseSuburb: "Invercargill", areaLat: -46.4132, areaLng: 168.3538, areaRadiusKm: 50, available: true } });
    const job = await schema.db.job.create({ data: { customerId: customer.id, category: "OTHER", status: "REVIEW", title: "Move a couch", description: "Move the couch upstairs.", addressLine1: "144 Private Street", suburb: "Windsor", city: "Invercargill", lat: -46.4132, lng: 168.3538, approxLat: -46.4117, approxLng: 168.3538, anyTime: true } });
    await priceJob(schema.db, { jobId: job.id, minutes: 120, materialsCents: 8500, pricedById: office.id });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "BOOKABLE" } });
    // Enough quote points to claim (starts with 3, claiming costs 5: #491).
    await schema.db.pointEntry.create({ data: { workerId: worker.id, delta: 2, reason: "OFFICE" } });
    return { job, customer, viewer: { userId: worker.id, role: "TRADIE" as const } };
  }
  it("spends the claim cost once in the claim transaction and refuses a claim without enough points (#491)", async () => {
    const { job, viewer } = await fixture();
    expect((await loadWorkerClaim(schema.db, viewer, job.id))?.points).toEqual({ balance: 5, cost: 5 });
    expect((await claimWorkerJob(schema.db, viewer, job.id)).status).toBe("claimed");
    expect(await pointBalance(schema.db, viewer.userId)).toBe(0);
    expect((await claimWorkerJob(schema.db, viewer, job.id)).status).toBe("claimed");
    expect(await pointBalance(schema.db, viewer.userId)).toBe(0);
    const other = await fixture();
    await schema.db.pointEntry.create({ data: { workerId: other.viewer.userId, delta: -3, reason: "OFFICE" } });
    expect(await claimWorkerJob(schema.db, other.viewer, other.job.id)).toEqual({ status: "points", balance: 2, cost: 5 });
    expect(await schema.db.job.findUnique({ where: { id: other.job.id } })).toMatchObject({ status: "BOOKABLE", workerId: null });
    expect(await schema.db.auditLog.count({ where: { recordId: other.job.id, action: "job.claimed" } })).toBe(0);
    await schema.db.settings.upsert({ where: { id: 1 }, create: { id: 1, claimPoints: 2 }, update: { claimPoints: 2 } });
    try { expect((await claimWorkerJob(schema.db, other.viewer, other.job.id)).status).toBe("claimed"); }
    finally { await schema.db.settings.update({ where: { id: 1 }, data: { claimPoints: 5 } }); }
    expect(await pointBalance(schema.db, other.viewer.userId)).toBe(0);
  });
  it("commits assignment, history, audit and private-recipient in-app notices together, then unlocks only the assignee", async () => {
    const { job, customer, viewer } = await fixture();
    expect((await loadWorkerClaim(schema.db, viewer, job.id))?.job.address).toBeNull();
    const result = await claimWorkerJob(schema.db, viewer, job.id);
    expect(result.status).toBe("claimed"); if (result.status !== "claimed") return;
    expect(result.job).toMatchObject({ assignedToYou: true, address: { line1: "144 Private Street" }, budgetCents: 8500 });
    expect(result.contactHref).toBe(`/messages?job=${job.id}`);
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "ASSIGNED", workerId: viewer.userId });
    const audit = await schema.db.auditLog.findMany({ where: { recordId: job.id, action: "job.claimed" } });
    expect(audit).toHaveLength(1); expect(audit[0]).toMatchObject({ actorId: viewer.userId });
    expect(await schema.db.jobStatusHistory.findMany({ where: { jobId: job.id, toStatus: "ASSIGNED" } })).toHaveLength(1);
    const notices = await schema.db.notification.findMany({ where: { type: "job.claimed", userId: { in: [viewer.userId, customer.id] } } });
    expect(notices).toHaveLength(2);
    for (const notice of notices) { expect(notice.payload).toEqual({ jobId: job.id, jobNumber: job.jobNumber }); expect(notice.channelsSent).toEqual([]); }
    expect((await claimWorkerJob(schema.db, viewer, job.id)).status).toBe("claimed");
    expect(await schema.db.auditLog.count({ where: { recordId: job.id, action: "job.claimed" } })).toBe(1);
  });
  it("rolls back assignment, history, audit and notices when the authorized projection query fails", async () => {
    const { job, customer, viewer } = await fixture();
    let inFlight: { assigned: boolean; audits: number; notices: number } | undefined;
    const failing = new Proxy(schema.db, { get(target, key) {
      if (key !== "$transaction") return Reflect.get(target, key, target);
      return (run: (tx: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction(tx => run(new Proxy(tx, { get(client, model) {
        if (model !== "tradeEvidenceRule") return Reflect.get(client, model, client);
        return new Proxy(client.tradeEvidenceRule, { get(delegate, method) {
          if (method !== "findUnique") return Reflect.get(delegate, method, delegate);
          return async () => {
            const current = await tx.job.findUnique({ where: { id: job.id }, select: { status: true, workerId: true } });
            inFlight = {
              assigned: current?.status === "ASSIGNED" && current.workerId === viewer.userId,
              audits: await tx.auditLog.count({ where: { recordId: job.id, action: "job.claimed" } }),
              notices: await tx.notification.count({ where: { type: "job.claimed", userId: { in: [viewer.userId, customer.id] } } }),
            };
            // A real PostgreSQL query error after all writes, while constructing the claimed projection.
            return tx.$queryRaw`SELECT 1 / 0`;
          };
        } });
      } })));
    } });
    expect(await claimWorkerJob(failing, viewer, job.id)).toEqual({ status: "unavailable" });
    expect(inFlight).toEqual({ assigned: true, audits: 1, notices: 2 });
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "BOOKABLE", workerId: null });
    expect(await schema.db.jobStatusHistory.count({ where: { jobId: job.id, toStatus: "ASSIGNED" } })).toBe(0);
    expect(await schema.db.auditLog.count({ where: { recordId: job.id, action: "job.claimed" } })).toBe(0);
    expect(await schema.db.notification.count({ where: { type: "job.claimed", userId: { in: [viewer.userId, customer.id] } } })).toBe(0);
    expect((await claimWorkerJob(schema.db, viewer, job.id)).status).toBe("claimed");
  });
  it("preserves committed success through post-commit read/contact faults and an idempotent retry", async () => {
    const { job, customer, viewer } = await fixture();
    let refuseOutsideRead = true, outsideReads = 0, contactReads = 0;
    const faulty = new Proxy(schema.db, { get(target, key) {
      if (key === "$transaction") return target.$transaction.bind(target);
      if (key === "job") return new Proxy(target.job, { get(delegate, method) {
        if (method !== "findUnique") return Reflect.get(delegate, method, delegate);
        return (...args: Parameters<typeof delegate.findUnique>) => {
          outsideReads++;
          if (refuseOutsideRead) throw Error("Post-commit job read unavailable");
          return delegate.findUnique(...args);
        };
      } });
      if (key === "supportThread") return new Proxy(target.supportThread, { get(delegate, method) {
        if (method !== "findFirst") return Reflect.get(delegate, method, delegate);
        return () => { contactReads++; throw Error("Contact lookup unavailable"); };
      } });
      return Reflect.get(target, key, target);
    } });
    const result = await claimWorkerJob(faulty, viewer, job.id);
    expect(result).toMatchObject({ status: "claimed", job: { assignedToYou: true, address: { line1: "144 Private Street" } }, contactHref: `/messages?job=${job.id}` });
    expect(outsideReads).toBe(0); expect(contactReads).toBe(1);
    refuseOutsideRead = false;
    expect(await claimWorkerJob(faulty, viewer, job.id)).toEqual(result);
    expect(contactReads).toBe(2);
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "ASSIGNED", workerId: viewer.userId });
    expect(await schema.db.jobStatusHistory.count({ where: { jobId: job.id, toStatus: "ASSIGNED" } })).toBe(1);
    expect(await schema.db.auditLog.count({ where: { recordId: job.id, action: "job.claimed" } })).toBe(1);
    expect(await schema.db.notification.count({ where: { type: "job.claimed", userId: { in: [viewer.userId, customer.id] } } })).toBe(2);
  });
  it("uses current eligibility, refusing a pause after the claim screen was read with no side effects", async () => {
    const { job, viewer } = await fixture();
    expect((await loadWorkerClaim(schema.db, viewer, job.id))?.failure).toBeNull();
    await schema.db.workerProfile.update({ where: { userId: viewer.userId }, data: { pausedAt: new Date() } });
    expect(await claimWorkerJob(schema.db, viewer, job.id)).toEqual({ status: "ineligible", failure: "worker-paused" });
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "BOOKABLE", workerId: null });
    expect(await schema.db.auditLog.count({ where: { recordId: job.id, action: "job.claimed" } })).toBe(0);
  });
  it("returns the lost-race state without leaking the winner, and distinguishes a cancelled job", async () => {
    const { job, viewer } = await fixture(), other = await person("TRADIE");
    await schema.db.job.update({ where: { id: job.id }, data: { status: "ASSIGNED", workerId: other.id } });
    expect(await claimWorkerJob(schema.db, viewer, job.id)).toEqual({ status: "lost" });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "CANCELLED" } });
    expect(await claimWorkerJob(schema.db, viewer, job.id)).toEqual({ status: "ineligible", failure: "not-open" });
    expect(await loadWorkerClaim(schema.db, viewer, job.id)).toBeNull();
  });
  it("rejects a wrong role, forged identity/fields and invalid id before any assignment", async () => {
    const { job, customer, viewer } = await fixture(), unrelated = await person("CUSTOMER");
    expect(await claimWorkerJob(schema.db, { userId: customer.id, role: "CUSTOMER" }, job.id)).toEqual({ status: "ineligible", failure: "worker-required" });
    expect(await claimWorkerJob(schema.db, { userId: customer.id, role: "TRADIE" }, job.id)).toEqual({ status: "ineligible", failure: "own-job" });
    expect(await claimWorkerJob(schema.db, { userId: unrelated.id, role: "TRADIE" }, job.id)).toEqual({ status: "ineligible", failure: "worker-required" });
    expect(await claimWorkerJob(schema.db, viewer, { jobId: job.id, workerId: customer.id })).toEqual({ status: "ineligible", failure: "not-open" });
    expect(await claimWorkerJob(schema.db, viewer, "not-a-job")).toEqual({ status: "ineligible", failure: "not-open" });
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "BOOKABLE", workerId: null });
  });
});
