import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Prisma, Role } from "@/generated/prisma/client";
import { timeWindowsInRange, type JobTimeWindow } from "@/lib/job-time-windows";
import { jobScheduleSchema } from "@/lib/job-draft";
import { availableBookingWindows } from "@/lib/worker-booking";
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
  it("permits the seven-day Any time choices and refuses past or forged later dates", async () => {
    const f = await fixture(true), before = await load(f); expect(before.windows).toHaveLength(21);
    for (const date of ["2026-11-10", "2026-11-18", "2027-11-11"]) expect((await bookJobWindow(schema.db, f.worker, f.job.id, { ...one, date }, before.revision, now)).status).toBe("invalid");
    expect((await bookJobWindow(schema.db, f.worker, f.job.id, { ...one, timeOfDay: "EVENING" }, before.revision, now)).status).toBe("booked");
    expect((await bookJobWindow(schema.db, f.worker, f.job.id, { date: "2026-11-17", timeOfDay: "EVENING" }, (await load(f)).revision, now)).status).toBe("booked");
  });
  it("asks once per hour, even simultaneously, and keeps the booking", async () => {
    const f = await fixture(); await bookJobWindow(schema.db, f.worker, f.job.id, one, (await load(f)).revision, now);
    const before = await load(f);
    expect(await Promise.all([requestOtherTimes(schema.db, f.worker, f.job.id, now), requestOtherTimes(schema.db, f.worker, f.job.id, now)])).toEqual([{ status: "asked" }, { status: "asked" }]);
    const requested = (await notices(f.job.id)).filter(n => n.type === "job.reschedule_requested"); expect(requested).toHaveLength(1); expect(requested[0].payload).toEqual({ jobId: f.job.id, jobNumber: f.job.jobNumber }); expect(inboxItem(requested[0]).href).toBe(`/jobs/${f.job.id}`); expect((await load(f)).booked).toEqual(before.booked);
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
  it("customer cannot remove the booked window and its restoration sends no added-times notice", async () => {
    const f = await fixture(); await bookJobWindow(schema.db, f.worker, f.job.id, one, (await load(f)).revision, now);
    const customer = (await loadJobWindows(schema.db, f.customer, f.job.id))!; expect(customer.editable).toBe(true);
    expect((await saveJobWindows(schema.db, f.customer, f.job.id, { asap: false, anyTime: false, timeWindows: [two] }, customer.revision, now)).status).toBe("saved");
    expect((await load(f)).windows).toContainEqual(one);
    expect((await notices(f.job.id)).filter(n => n.type === "job.times_added")).toHaveLength(0);
  });
  it("notifies the assigned worker only for an actual new choice, with a booking link", async () => {
    const f = await fixture();
    const save = async (timeWindows: JobTimeWindow[]) => saveJobWindows(schema.db, f.customer, f.job.id, { asap: true, anyTime: false, timeWindows }, (await loadJobWindows(schema.db, f.customer, f.job.id))!.revision, now);
    const added = { date: "2026-11-14", timeOfDay: "MORNING" as const };
    expect((await save([one, two])).status).toBe("saved");
    expect((await save([one])).status).toBe("saved");
    expect((await notices(f.job.id)).filter(n => n.type === "job.times_added")).toHaveLength(0);
    expect((await save([one, added])).status).toBe("saved");
    expect((await save([one, added])).status).toBe("saved");
    const notifications = (await notices(f.job.id)).filter(n => n.type === "job.times_added"); expect(notifications).toHaveLength(1);
    expect(notifications[0].userId).toBe(f.worker.userId); expect(inboxItem(notifications[0]).href).toBe(`/jobs/${f.job.id}/book`);
  });
  it("distinguishes adding Any time from refreshing its dated rows on an ASAP-only save", async () => {
    for (const anyTime of [true, false]) {
      const f = await fixture(anyTime), before = (await loadJobWindows(schema.db, f.customer, f.job.id))!;
      expect((await saveJobWindows(schema.db, f.customer, f.job.id, { asap: true, anyTime: true, timeWindows: [] }, before.revision, now)).status).toBe("saved");
      expect((await notices(f.job.id)).filter(n => n.type === "job.times_added")).toHaveLength(anyTime ? 0 : 1);
    }
  });

  for (const anyTime of [false, true]) it(`refreshes ${anyTime ? "Any time" : "explicit"} choices across Auckland midnight without a manual reload`, async () => {
    const f = await fixture(anyTime), beforeMidnight = new Date("2026-11-11T10:59:00Z"), afterMidnight = new Date("2026-11-11T11:01:00Z");
    const expiring = { date: "2026-11-11", timeOfDay: "MORNING" as const };
    if (!anyTime) await schema.db.jobTimeWindow.create({ data: { jobId: f.job.id, date: new Date(expiring.date), timeOfDay: expiring.timeOfDay } });
    const before = (await loadBooking(schema.db, f.worker, f.job.id, beforeMidnight))!; expect(before.windows).toContainEqual(expiring);
    const result = await bookJobWindow(schema.db, f.worker, f.job.id, expiring, before.revision, afterMidnight);
    expect(result.status).toBe("changed"); if (result.status !== "changed") throw Error("Expected refreshed choices");
    expect(result.snapshot.windows).not.toContainEqual(expiring); expect(result.snapshot.revision).not.toBe(before.revision);
    expect(await notices(f.job.id)).toHaveLength(0); expect(await schema.db.auditLog.count({ where: { recordId: f.job.id } })).toBe(0);
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).bookedDate).toBeNull();
    expect((await bookJobWindow(schema.db, f.worker, f.job.id, result.snapshot.windows[0], result.snapshot.revision, afterMidnight)).status).toBe("booked");
  });

  for (const retainedDate of ["2026-11-10", "2026-11-20"]) it(`keeps the raw ${retainedDate} booking while editable snapshots reload and save without range errors`, async () => {
    const f = await fixture(), retained = { date: retainedDate, timeOfDay: "MORNING" as const };
    await schema.db.jobTimeWindow.create({ data: { jobId: f.job.id, date: new Date(retainedDate), timeOfDay: retained.timeOfDay } });
    const bookingNow = retainedDate < "2026-11-11" ? new Date("2026-11-10T00:00:00Z") : now;
    const workerInitial = (await loadBooking(schema.db, f.worker, f.job.id, bookingNow))!;
    expect((await bookJobWindow(schema.db, f.worker, f.job.id, retained, workerInitial.revision, bookingNow)).status).toBe("booked");
    const initial = (await loadJobWindows(schema.db, f.customer, f.job.id, now))!, earlierView = (await loadJobWindows(schema.db, f.customer, f.job.id, bookingNow))!;
    expect(initial.revision).toBe(earlierView.revision); expect(initial.schedule.timeWindows).not.toContainEqual(retained);
    const workerBefore = (await loadBooking(schema.db, f.worker, f.job.id, now))!;
    const choices = availableBookingWindows([], true, now), input = { asap: false, anyTime: false, timeWindows: choices };
    const first = await saveJobWindows(schema.db, f.customer, f.job.id, input, initial.revision, now);
    if (first.status !== "saved") throw Error("Expected saved future choices");
    expect(first.snapshot.schedule.timeWindows).toEqual(choices); expect(jobScheduleSchema.safeParse(first.snapshot.schedule).success).toBe(true); expect(timeWindowsInRange(first.snapshot.schedule.timeWindows, now)).toBe(true);
    expect(await schema.db.jobTimeWindow.count({ where: { jobId: f.job.id } })).toBe(22);
    expect(await schema.db.jobTimeWindow.count({ where: { jobId: f.job.id, date: new Date(retainedDate), timeOfDay: retained.timeOfDay } })).toBe(1);
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).bookedDate?.toISOString().slice(0, 10)).toBe(retainedDate);
    const reloaded = (await loadJobWindows(schema.db, f.customer, f.job.id, now))!; expect(reloaded).toEqual(first.snapshot);
    const repeated = await saveJobWindows(schema.db, f.customer, f.job.id, reloaded.schedule, reloaded.revision, now);
    expect(repeated).toMatchObject({ status: "saved", snapshot: { revision: reloaded.revision, schedule: reloaded.schedule } });
    expect((await notices(f.job.id)).filter(n => n.type === "job.times_added")).toHaveLength(1);
    const stale = await bookJobWindow(schema.db, f.worker, f.job.id, one, workerBefore.revision, now); expect(stale.status).toBe("changed");
    if (stale.status !== "changed") throw Error("Expected current worker choices");
    expect((await bookJobWindow(schema.db, f.worker, f.job.id, one, stale.snapshot.revision, now)).status).toBe("booked");
    const customerStale = await saveJobWindows(schema.db, f.customer, f.job.id, reloaded.schedule, reloaded.revision, now);
    expect(customerStale.status).toBe("changed");
    if (customerStale.status !== "changed") throw Error("Expected current booking revision");
    expect(jobScheduleSchema.safeParse(customerStale.snapshot.schedule).success).toBe(true); expect(timeWindowsInRange(customerStale.snapshot.schedule.timeWindows, now)).toBe(true);
    expect((await saveJobWindows(schema.db, f.customer, f.job.id, customerStale.snapshot.schedule, customerStale.snapshot.revision, now)).status).toBe("saved");
  });

});
