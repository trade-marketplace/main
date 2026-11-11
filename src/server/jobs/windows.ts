import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { draftFieldErrors, jobScheduleSchema } from "@/lib/job-draft";
import { currentSchedule, timeWindowKey, timeWindowsInRange } from "@/lib/job-time-windows";
import { availableBookingWindows } from "@/lib/worker-booking";
import { canEditJobWindows, type JobWindowsSnapshot, type SaveJobWindowsResult } from "@/lib/job-windows";
import type { Viewer } from "@/server/auth/viewer";
import { createAudit } from "@/server/audit/audit";
import { createNotify } from "@/server/notifications/notify";
import { lockJobWindows } from "./window-lock";

export const WINDOWS_EXPIRED_RULE = "job.windows_expired";
const SELECT = { id: true, jobNumber: true, title: true, customerId: true, status: true, workerId: true, asap: true, anyTime: true, bookedDate: true, bookedTime: true, timeWindows: { orderBy: [{ date: "asc" }, { timeOfDay: "asc" }], select: { date: true, timeOfDay: true } } } satisfies Prisma.JobSelect;
type Row = Prisma.JobGetPayload<{ select: typeof SELECT }>;
export function windowsRevision(schedule: { anyTime: boolean; asap: boolean; timeWindows: { date: string; timeOfDay: string }[]; booked?: { date: string; timeOfDay: string } | null }) {
  return createHash("sha256").update(JSON.stringify({ booked: schedule.booked ?? null, asap: schedule.asap, anyTime: schedule.anyTime, timeWindows: [...schedule.timeWindows].sort((a, b) => `${a.date}/${a.timeOfDay}`.localeCompare(`${b.date}/${b.timeOfDay}`)) })).digest("hex");
}
function snapshot(job: Row): JobWindowsSnapshot {
  const schedule = { asap: job.asap, anyTime: job.anyTime, timeWindows: job.timeWindows.map(window => ({ date: window.date.toISOString().slice(0, 10), timeOfDay: window.timeOfDay })) };
  return { id: job.id, jobNumber: job.jobNumber, title: job.title, editable: canEditJobWindows(job), revision: windowsRevision({ ...schedule, booked: job.bookedDate && job.bookedTime ? { date: job.bookedDate.toISOString().slice(0, 10), timeOfDay: job.bookedTime } : null }), schedule };
}
export async function loadJobWindows(db: PrismaClient, viewer: Viewer, id: string) {
  if (viewer.role !== "CUSTOMER" || !z.uuid().safeParse(id).success) return null;
  const job = await db.job.findFirst({ where: { id, customerId: viewer.userId }, select: SELECT });
  return job ? snapshot(job) : null;
}
export async function saveJobWindows(db: PrismaClient, viewer: Viewer, id: string, input: unknown, revision: string, now = new Date()): Promise<SaveJobWindowsResult> {
  if (viewer.role !== "CUSTOMER" || !z.uuid().safeParse(id).success) return { status: "forbidden" };
  const parsed = jobScheduleSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", fields: draftFieldErrors(parsed.error) };
  const schedule = currentSchedule(parsed.data, now);
  if (!timeWindowsInRange(schedule.timeWindows, now)) return { status: "invalid", fields: { timeWindows: "When do you need it?" } };
  return db.$transaction(async tx => {
    await lockJobWindows(tx, id);
    const profile = await tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } });
    const job = await tx.job.findFirst({ where: { id, customerId: viewer.userId }, select: SELECT });
    if (profile?.role !== "CUSTOMER" || !job) return { status: "forbidden" };
    const before = snapshot(job);
    if (!before.editable || before.revision !== revision) return { status: "changed", snapshot: before };
    if (!schedule.anyTime && job.bookedDate && job.bookedTime) {
      const booked = { date: job.bookedDate.toISOString().slice(0, 10), timeOfDay: job.bookedTime };
      if (!schedule.timeWindows.some(window => window.date === booked.date && window.timeOfDay === booked.timeOfDay)) schedule.timeWindows.push(booked);
    }
    await tx.jobTimeWindow.deleteMany({ where: { jobId: id } });
    if (schedule.timeWindows.length) await tx.jobTimeWindow.createMany({ data: schedule.timeWindows.map(window => ({ jobId: id, date: new Date(`${window.date}T00:00:00Z`), timeOfDay: window.timeOfDay })) });
    await tx.job.update({ where: { id }, data: { asap: schedule.asap, anyTime: schedule.anyTime } });
    await tx.scheduledJobMark.deleteMany({ where: { jobId: id, rule: WINDOWS_EXPIRED_RULE } });
    const audit = await createAudit(tx)(viewer, "job.windows_updated", { type: "jobs", id }, before.schedule, schedule);
    const previousChoices = new Set(availableBookingWindows(before.schedule.timeWindows, before.schedule.anyTime, now).map(timeWindowKey));
    const addedChoices = availableBookingWindows(schedule.timeWindows, schedule.anyTime, now).some(window => !previousChoices.has(timeWindowKey(window)));
    if (job.status === "ASSIGNED" && job.workerId && addedChoices) await createNotify(tx)("job.times_added", [job.workerId], { eventId: `job.times_added:${audit.id}`, payload: { jobId: id, jobNumber: job.jobNumber } });
    const updated = await tx.job.findUniqueOrThrow({ where: { id }, select: SELECT });
    return { status: "saved", snapshot: snapshot(updated) };
  });
}
