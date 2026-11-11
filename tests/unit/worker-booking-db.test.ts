import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Prisma, Role } from "@/generated/prisma/client";
import type { Viewer } from "@/server/auth/viewer";
import { bookJobWindow, loadBooking, requestOtherTimes } from "@/server/jobs/worker-booking";
import { loadJobWindows, saveJobWindows } from "@/server/jobs/windows";
import { inboxItem } from "@/server/notifications/inbox";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";
describe.skipIf(!testDatabaseUrl)("worker booking database", () => {
  const schema = useTestSchema(import.meta.filename), now = new Date("2026-11-11T00:00:00Z");
  const one = { date: "2026-11-12", timeOfDay: "MORNING" as const }, two = { date: "2026-11-13", timeOfDay: "AFTERNOON" as const };
  async function person(role: Role): Promise<Viewer> {
    const userId = randomUUID(), email = `${userId}@example.test`;
    await schema.db.$executeRaw`INSERT INTO auth.users(id) VALUES(${userId}::uuid)`;
    await schema.db.profile.create({ data: { id: userId, email, firstName: "Sarah", role } });
    return { userId, email, firstName: "Sarah", role, emailVerified: true };
  }
  async function fixture(anyTime = false) {
    const customer = await person("CUSTOMER"), worker = await person("TRADIE");
    const job = await schema.db.job.create({ data: { customerId: customer.userId, workerId: worker.userId, status: "ASSIGNED", priceCents: 12000, title: "Sub wiring", description: "Check wiring", category: "OTHER", addressLine1: "146 Private Street", suburb: "Windsor", city: "Invercargill", anyTime, timeWindows: { create: [one, two].map(window => ({ date: new Date(window.date), timeOfDay: window.timeOfDay })) } } });
    return { job, customer, worker };
  }
  const load = async (f: Awaited<ReturnType<typeof fixture>>) => (await loadBooking(schema.db, f.worker, f.job.id, now))!;
  const notices = (id: string) => schema.db.notification.findMany({ where: { payload: { path: ["jobId"], equals: id } } });
  it("books once, preserves private fields, and changing windows notifies as rescheduled", async () => {
    const f = await fixture(), before = await load(f);
    expect(await bookJobWindow(schema.db, f.worker, f.job.id, one, before.revision, now)).toMatchObject({ status: "booked", rescheduled: false });
    expect((await notices(f.job.id))[0]).toMatchObject({ userId: f.customer.userId, type: "job.window_booked", payload: { ...one, rescheduled: false } });
    const booked = await load(f);
    expect(await bookJobWindow(schema.db, f.worker, f.job.id, one, booked.revision, now)).toMatchObject({ status: "booked" });
    expect(await notices(f.job.id)).toHaveLength(1);
    await bookJobWindow(schema.db, f.worker, f.job.id, two, booked.revision, now);
    expect(await schema.db.auditLog.count({ where: { recordId: f.job.id, action: "job.window_booked" } })).toBe(2);
    expect((await notices(f.job.id)).some(n => (n.payload as Record<string, unknown>).rescheduled === true)).toBe(true);
    expect(await schema.db.job.findUnique({ where: { id: f.job.id } })).toMatchObject({ status: "ASSIGNED", customerId: f.customer.userId, workerId: f.worker.userId, addressLine1: "146 Private Street", bookedTime: two.timeOfDay });
  });
  it("refuses forged, unoffered, past windows and invalid ids", async () => {
    const f = await fixture(), before = await load(f);
    for (const value of [{ ...one, timeOfDay: "EVENING" }, { ...one, date: "2026-11-10" }, { ...one, priceCents: 1 }, { date: "bad", timeOfDay: "MORNING" }]) expect(await bookJobWindow(schema.db, f.worker, f.job.id, value, before.revision, now)).toEqual({ status: "invalid" });
    expect(await bookJobWindow(schema.db, f.worker, "bad", one, before.revision, now)).toEqual({ status: "forbidden" }); expect(await notices(f.job.id)).toHaveLength(0);
  });
  it("refuses foreign workers, stale roles, customers and jobs no longer assigned", async () => {
    const f = await fixture(), before = await load(f), foreign = await person("TRADIE");
    for (const viewer of [foreign, f.customer]) { expect(await loadBooking(schema.db, viewer, f.job.id, now)).toBeNull(); expect(await bookJobWindow(schema.db, viewer, f.job.id, one, before.revision, now)).toEqual({ status: "forbidden" }); expect(await requestOtherTimes(schema.db, viewer, f.job.id, now)).toEqual({ status: "forbidden" }); }
    await schema.db.profile.update({ where: { id: f.worker.userId }, data: { role: "CUSTOMER" } });
    expect(await bookJobWindow(schema.db, f.worker, f.job.id, one, before.revision, now)).toEqual({ status: "forbidden" });
    expect(await requestOtherTimes(schema.db, f.worker, f.job.id, now)).toEqual({ status: "forbidden" });
    const other = await fixture(); await schema.db.job.update({ where: { id: other.job.id }, data: { status: "SUBMITTED" } });
    expect(await load(other)).toBeNull(); expect(await bookJobWindow(schema.db, other.worker, other.job.id, one, "old", now)).toEqual({ status: "forbidden" }); expect(await requestOtherTimes(schema.db, other.worker, other.job.id, now)).toEqual({ status: "forbidden" });
  });
  it("permits any-time choices and rejects past dates there too", async () => {
    const f = await fixture(true), before = await load(f); expect(before.windows).toHaveLength(21);
    expect((await bookJobWindow(schema.db, f.worker, f.job.id, { ...one, date: "2026-11-10" }, before.revision, now)).status).toBe("invalid");
    expect((await bookJobWindow(schema.db, f.worker, f.job.id, { ...one, timeOfDay: "EVENING" }, before.revision, now)).status).toBe("booked");
  });
  it("asks once per hour, even simultaneously, and keeps the booking", async () => {
    const f = await fixture(); await bookJobWindow(schema.db, f.worker, f.job.id, one, (await load(f)).revision, now);
    const before = await load(f);
    expect(await Promise.all([requestOtherTimes(schema.db, f.worker, f.job.id, now), requestOtherTimes(schema.db, f.worker, f.job.id, now)])).toEqual([{ status: "asked" }, { status: "asked" }]);
    expect((await notices(f.job.id)).filter(n => n.type === "job.reschedule_requested")).toHaveLength(1); expect((await load(f)).booked).toEqual(before.booked);
  });
  for (const first of ["customer", "worker"] as const) it(`serializes ${first}-first save/booking race and returns changed to the second`, async () => {
    const f = await fixture(), worker = await load(f), customer = (await loadJobWindows(schema.db, f.customer, f.job.id))!;
    let release!: () => void, locked!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { locked = resolve; });
    // Pause the actual first command immediately after it acquires the row lock. The second
    // command then starts against that held lock, without relying on pool/statement arrival order.
    const firstDb = new Proxy(schema.db, { get(target, key, receiver) {
      if (key !== "$transaction") return Reflect.get(target, key, receiver);
      return (command: (tx: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction(tx => command(new Proxy(tx, { get(transaction, field, transactionReceiver) {
        if (field !== "job") return Reflect.get(transaction, field, transactionReceiver);
        return new Proxy(transaction.job, { get(jobs, operation, jobsReceiver) {
          if (operation !== "updateMany") return Reflect.get(jobs, operation, jobsReceiver);
          return async (args: Prisma.JobUpdateManyArgs) => { const result = await jobs.updateMany(args); locked(); await gate; return result; };
        } });
      } })));
    } });
    const save = (db = schema.db) => saveJobWindows(db, f.customer, f.job.id, { asap: false, anyTime: false, timeWindows: [two] }, customer.revision, now);
    const book = (db = schema.db) => bookJobWindow(db, f.worker, f.job.id, one, worker.revision, now);
    const earlier = first === "customer" ? save(firstDb) : book(firstDb); await entered;
    const later = first === "customer" ? book() : save(); release();
    expect((await earlier).status).toBe(first === "customer" ? "saved" : "booked"); expect((await later).status).toBe("changed");
    const after = await load(f); if (after.booked) expect(after.windows).toContainEqual(after.booked);
  });
  it("customer cannot remove the booked window and assigned-worker notification links to booking", async () => {
    const f = await fixture(); await bookJobWindow(schema.db, f.worker, f.job.id, one, (await load(f)).revision, now);
    const customer = (await loadJobWindows(schema.db, f.customer, f.job.id))!; expect(customer.editable).toBe(true);
    expect((await saveJobWindows(schema.db, f.customer, f.job.id, { asap: false, anyTime: false, timeWindows: [two] }, customer.revision, now)).status).toBe("saved");
    expect((await load(f)).windows).toContainEqual(one);
    const notification = (await notices(f.job.id)).find(n => n.type === "job.times_added")!; expect(notification.userId).toBe(f.worker.userId); expect(inboxItem(notification).href).toBe(`/jobs/${f.job.id}/book`);
  });
});
