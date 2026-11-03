import "server-only";
import { postingDateRange, timeWindowsExpired } from "@/lib/job-time-windows";
import { WINDOWS_EXPIRED_RULE, windowsRevision } from "@/server/jobs/windows";
import { createNotify } from "@/server/notifications/notify";
import { lockJobWindows } from "@/server/jobs/window-lock";
import type { SchedulerRule, RuleResult } from "./rules";

/** A dated selection expires at Auckland midnight. Any time and legacy empty selections remain flexible. */
export const windowExpiry: SchedulerRule = {
  name: "window-expiry",
  async run(context) {
    const today = new Date(`${postingDateRange(context.now).today}T00:00:00Z`);
    const due = await context.db.job.findMany({
      where: { status: "BOOKABLE", workerId: null, anyTime: false, timeWindows: { some: {}, none: { date: { gte: today } } }, scheduledMarks: { none: { rule: WINDOWS_EXPIRED_RULE } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: context.limit, select: { id: true },
    });
    const result: RuleResult = { rule: "window-expiry", due: due.length, done: 0, skipped: 0, failed: 0 };
    for (const { id } of due) {
      try {
        const outcome = await context.db.$transaction(async tx => {
          // The customer editor and claim guard use this same row lock. Recheck after any wait.
          await lockJobWindows(tx, id);
          const job = await tx.job.findUnique({ where: { id }, select: { id: true, jobNumber: true, customerId: true, status: true, workerId: true, anyTime: true, asap: true, timeWindows: { select: { date: true, timeOfDay: true } } } });
          if (!job || job.status !== "BOOKABLE" || job.workerId !== null) return "skipped";
          const schedule = { anyTime: job.anyTime, asap: job.asap, timeWindows: job.timeWindows.map(window => ({ date: window.date.toISOString().slice(0, 10), timeOfDay: window.timeOfDay })) };
          if (!timeWindowsExpired(schedule.timeWindows, schedule.anyTime, context.now)) return "skipped";
          const mark = await tx.scheduledJobMark.createMany({ data: [{ rule: WINDOWS_EXPIRED_RULE, jobId: id, markedAt: context.now }], skipDuplicates: true });
          if (!mark.count) return "skipped";
          await createNotify(tx)("job.reschedule_requested", [job.customerId], { eventId: `windows.expired:${id}:${windowsRevision(schedule)}`, payload: { jobId: id, jobNumber: job.jobNumber, refreshWindows: true } });
          return "done";
        });
        result[outcome]++;
      } catch { result.failed++; console.error("Expired-window reminder could not be delivered."); }
    }
    return result;
  },
};
