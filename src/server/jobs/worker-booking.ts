import "server-only";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { availableBookingWindows, type BookingResult, type BookingSnapshot, type RequestTimesResult } from "@/lib/worker-booking";
import { postingDateRange, timeWindowKey, type JobTimeWindow } from "@/lib/job-time-windows";
import type { Viewer } from "@/server/auth/viewer";
import { createAudit } from "@/server/audit/audit";
import { createNotify } from "@/server/notifications/notify";
import { lockJobWindows } from "./window-lock";
import { windowsRevision } from "./windows";
const SELECT = { id: true, jobNumber: true, title: true, suburb: true, customerId: true, customer: { select: { firstName: true } }, asap: true, anyTime: true, bookedDate: true, bookedTime: true, timeWindows: { select: { date: true, timeOfDay: true } } } satisfies Prisma.JobSelect;
type Row = Prisma.JobGetPayload<{ select: typeof SELECT }>;
function snapshot(job: Row, now: Date): BookingSnapshot {
  const timeWindows = job.timeWindows.map(window => ({ date: window.date.toISOString().slice(0, 10), timeOfDay: window.timeOfDay }));
  const booked = job.bookedDate && job.bookedTime ? { date: job.bookedDate.toISOString().slice(0, 10), timeOfDay: job.bookedTime } : null;
  return { id: job.id, title: job.title, suburb: job.suburb, customerFirstName: job.customer.firstName, anyTime: job.anyTime, windows: availableBookingWindows(timeWindows, job.anyTime, now), booked, revision: windowsRevision({ asap: job.asap, anyTime: job.anyTime, timeWindows, booked }) };
}
const permitted = (viewer: Viewer, id: string) => viewer.role === "TRADIE" && z.uuid().safeParse(id).success;
export async function loadBooking(db: PrismaClient, viewer: Viewer, id: string, now = new Date()) {
  if (!permitted(viewer, id)) return null;
  const job = await db.job.findFirst({ where: { id, workerId: viewer.userId, status: "ASSIGNED" }, select: SELECT });
  return job ? snapshot(job, now) : null;
}
const windowSchema = z.object({ date: z.iso.date(), timeOfDay: z.enum(["MORNING", "AFTERNOON", "EVENING"]) }).strict();
export async function bookJobWindow(db: PrismaClient, viewer: Viewer, id: string, input: unknown, revision: string, now = new Date()): Promise<BookingResult> {
  if (!permitted(viewer, id)) return { status: "forbidden" };
  const parsed = windowSchema.safeParse(input);
  return db.$transaction(async tx => {
    await lockJobWindows(tx, id);
    const profile = await tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } });
    const job = await tx.job.findFirst({ where: { id, workerId: viewer.userId, status: "ASSIGNED" }, select: SELECT });
    if (profile?.role !== "TRADIE" || !job) return { status: "forbidden" };
    const before = snapshot(job, now);
    if (before.revision !== revision) return { status: "changed", snapshot: before };
    if (!parsed.success) return { status: "invalid" };
    const window: JobTimeWindow = parsed.data;
    if (window.date < postingDateRange(now).today || !before.windows.some(offered => timeWindowKey(offered) === timeWindowKey(window))) return { status: "invalid" };
    const rescheduled = before.booked !== null;
    if (before.booked && timeWindowKey(before.booked) === timeWindowKey(window)) return { status: "booked", window, rescheduled: false };
    await tx.job.update({ where: { id }, data: { bookedDate: new Date(`${window.date}T00:00:00Z`), bookedTime: window.timeOfDay } });
    const audit = await createAudit(tx)(viewer, "job.window_booked", { type: "jobs", id }, before.booked, window);
    await createNotify(tx)("job.window_booked", [job.customerId], { eventId: `job.window_booked:${audit.id}`, payload: { jobId: id, jobNumber: job.jobNumber, date: window.date, timeOfDay: window.timeOfDay, rescheduled } });
    return { status: "booked", window, rescheduled };
  });
}
export async function requestOtherTimes(db: PrismaClient, viewer: Viewer, id: string, now = new Date()): Promise<RequestTimesResult> {
  if (!permitted(viewer, id)) return { status: "forbidden" };
  return db.$transaction(async tx => {
    await lockJobWindows(tx, id);
    const profile = await tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } });
    const job = await tx.job.findFirst({ where: { id, workerId: viewer.userId, status: "ASSIGNED" }, select: SELECT });
    if (profile?.role !== "TRADIE" || !job) return { status: "forbidden" };
    const recent = await tx.auditLog.findFirst({ where: { action: "job.times_requested", recordType: "jobs", recordId: id, actorId: viewer.userId, createdAt: { gte: new Date(now.getTime() - 3_600_000) } } });
    if (recent) return { status: "asked" };
    const audit = await createAudit(tx)(viewer, "job.times_requested", { type: "jobs", id }, null, { requested: true });
    await createNotify(tx)("job.reschedule_requested", [job.customerId], { eventId: `job.times_requested:${audit.id}`, payload: { jobId: id, jobNumber: job.jobNumber } });
    return { status: "asked" };
  });
}
