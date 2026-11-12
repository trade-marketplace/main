import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Viewer } from "@/server/auth/viewer";
import type { PrismaClient, Role } from "@/generated/prisma/client";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";
import { loadWorkerExtras } from "@/server/jobs/worker-extras";
import { priceJob } from "@/server/pricing/price-job";
const current = vi.hoisted(() => ({ viewer: null as Viewer | null, db: null as PrismaClient | null }));
vi.mock("@/server/auth/viewer", () => ({ getViewer: async () => current.viewer }));
vi.mock("@/server/db", () => ({ getDb: () => current.db }));
import { requestVariationAction } from "@/server/variations/actions";
describe.skipIf(!testDatabaseUrl)("worker extra work with the existing guarded action", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: Role) {
    const id = randomUUID(); await schema.db.$executeRaw`INSERT INTO auth.users(id) VALUES(${id}::uuid)`;
    await schema.db.profile.create({ data: { id, email: `${id}@example.test`, firstName: "Test", role } });
    return { userId: id, role, firstName: "Test", email: `${id}@example.test`, emailVerified: true } satisfies Viewer;
  }
  async function fixture() {
    current.db = schema.db;
    const customer = await person("CUSTOMER"), worker = await person("TRADIE"), other = await person("TRADIE");
    const job = await schema.db.job.create({ data: { customerId: customer.userId, category: "OTHER", title: "Moving", description: "Move the table upstairs", addressLine1: "1 Example St", suburb: "Windsor", city: "Invercargill" } });
    await priceJob(schema.db, { jobId: job.id, minutes: 60, materialsCents: 0 });
    await schema.db.job.update({ where: { id: job.id }, data: { workerId: worker.userId, status: "ASSIGNED" } });
    const requestKey = randomUUID(), path = `variations/${job.id}/${worker.userId}/${randomUUID().replaceAll("-", "")}.webp`;
    await schema.db.variationPhoto.create({ data: { path, jobId: job.id, uploadedById: worker.userId, requestKey, ready: true } });
    return { customer, worker, other, job, input: { jobId: job.id, requestKey, description: "Move another table upstairs", hours: .5, photoPaths: [path] } };
  }
  it("shows an action's REQUESTED result, returns no customer price, and double send creates one row", async () => {
    const f = await fixture(); current.viewer = f.worker;
    const first = await requestVariationAction(f.input), second = await requestVariationAction(f.input);
    expect(first).toEqual(second); expect(first.ok).toBe(true);
    expect(await schema.db.variation.count({ where: { jobId: f.job.id } })).toBe(1);
    const rows = await loadWorkerExtras(schema.db, f.worker, f.job.id); expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ status: "REQUESTED", requestedMinutes: 30, photoCount: 1, workerEarnsCents: null });
    expect(Object.keys(rows[0]).sort()).toEqual(["id", "status", "description", "requestedMinutes", "minutes", "workerEarnsCents", "photoCount", "createdAt"].sort());
    for (const viewer of [f.customer, f.other, await person("ADMIN")]) expect(await loadWorkerExtras(schema.db, viewer, f.job.id)).toEqual([]);
    await schema.db.profile.update({ where: { id: f.worker.userId }, data: { role: "CUSTOMER" } }); expect(await loadWorkerExtras(schema.db, f.worker, f.job.id)).toEqual([]);
  });
  it("refuses another tradie and a job no longer assigned, and requires a photo", async () => {
    const f = await fixture(); current.viewer = f.other; expect(await requestVariationAction(f.input)).toMatchObject({ ok: false, error: "not-found" });
    current.viewer = f.worker; expect(await requestVariationAction({ ...f.input, photoPaths: [] })).toMatchObject({ error: "invalid" });
    await schema.db.job.update({ where: { id: f.job.id }, data: { status: "CANCEL_REVIEW" } }); expect(await requestVariationAction(f.input)).toMatchObject({ ok: false });
    expect(await schema.db.variation.count({ where: { jobId: f.job.id } })).toBe(0);
  });
  it("limits history to the newest five without granting the former worker access after reassignment", async () => {
    const f = await fixture();
    for (let i = 0; i < 6; i++) await schema.db.variation.create({ data: { jobId: f.job.id, requestedById: f.worker.userId, description: `Extra ${i}`, requestedMinutes: 15, createdAt: new Date(1000 + i) } });
    expect((await loadWorkerExtras(schema.db, f.worker, f.job.id)).map(row => row.description)).toEqual(["Extra 5", "Extra 4", "Extra 3", "Extra 2", "Extra 1"]);
    await schema.db.job.update({ where: { id: f.job.id }, data: { workerId: f.other.userId } }); expect(await loadWorkerExtras(schema.db, f.worker, f.job.id)).toEqual([]);
  });
});
