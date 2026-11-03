import "server-only";
import { licenceToday } from "@/lib/account/trades";
import { createNotify } from "@/server/notifications/notify";
import type { SchedulerRule } from "./rules";

/** One reminder per reviewed licence/expiry. The conditional update and notification commit together. */
export const licenceExpiryReminder: SchedulerRule = {
  name: "licence-expiry-reminder",
  async run({ db, now, limit }) {
    const today = new Date(`${licenceToday(now)}T00:00:00Z`);
    const until = new Date(today); until.setUTCDate(until.getUTCDate() + 30);
    const where = { status: "VERIFIED" as const, expiryRemindedAt: null, expiresOn: { gte: today, lte: until } };
    const due = await db.licence.findMany({ where, orderBy: [{ expiresOn: "asc" }, { id: "asc" }], take: limit, select: { id: true, expiresOn: true } });
    const result = { rule: "licence-expiry-reminder", due: due.length, done: 0, skipped: 0, failed: 0 };
    for (const candidate of due) {
      try {
        const done = await db.$transaction(async tx => {
          const claimed = await tx.licence.updateMany({ where: { id: candidate.id, ...where, expiresOn: candidate.expiresOn }, data: { expiryRemindedAt: now } });
          if (!claimed.count) return false;
          const licence = await tx.licence.findUniqueOrThrow({ where: { id: candidate.id }, select: { id: true, userId: true, trade: true, expiresOn: true } });
          await createNotify(tx)("licence.expiring", [licence.userId], {
            eventId: `licence.expiring:${licence.id}:${licence.expiresOn!.toISOString()}`,
            payload: { licenceId: licence.id, trade: licence.trade, expiresOn: licence.expiresOn!.toISOString().slice(0, 10), path: "/profile/trades" },
          });
          return true;
        });
        result[done ? "done" : "skipped"]++;
      } catch { result.failed++; console.error("Licence expiry reminder unavailable."); }
    }
    return result;
  },
};
