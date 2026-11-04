import "server-only";
import { randomUUID } from "node:crypto";
import type { SchedulerRule } from "@/server/scheduler/rules";
import { firebasePushSender, type PushSender } from "./firebase-provider";

const MAX_ATTEMPTS = 5;
const MIN_REMAINING = 12_000;
export function createPriceReadyPushRule(options: { sender?: PushSender | null; wallClock?: () => number } = {}): SchedulerRule {
  return { name: "price-ready-push", async run(context) {
    const clock = options.wallClock ?? Date.now, started = clock();
    const deadline = context.deadlineAt?.getTime() ?? started + 15_000;
    const now = () => new Date(context.now.getTime() + Math.max(0, clock() - started));
    const enough = () => deadline - clock() >= MIN_REMAINING;
    const result = { rule: "price-ready-push", due: 0, done: 0, skipped: 0, failed: 0 };
    const limit = Number.isFinite(context.limit) ? Math.max(0, Math.min(2, Math.floor(context.limit))) : 0;
    if (!limit || !enough()) return result;
    const pending = (at: Date) => ({ deliveredAt: null, failedAt: null, displayedAt: null, dueAt: { lte: at }, OR: [{ leasedUntil: null }, { leasedUntil: { lte: at } }] });
    const rows = await context.db.priceReadyPushDelivery.findMany({ where: pending(now()), orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: limit, select: { id: true } });
    result.due = rows.length;
    const sender = options.sender === undefined ? firebasePushSender() : options.sender;
    if (!sender) { result.failed = rows.length; return result; }
    for (const row of rows) {
      if (!enough()) { result.skipped++; continue; }
      const leaseToken = randomUUID();
      try {
        const claim = await context.db.$transaction(async tx => {
          const at = now();
          const won = await tx.priceReadyPushDelivery.updateMany({ where: { id: row.id, ...pending(at) }, data: { leaseToken, leasedUntil: new Date(at.getTime() + 30_000) } });
          if (!won.count) return null;
          const current = await tx.priceReadyPushDelivery.findUniqueOrThrow({ where: { id: row.id }, include: { registration: true, job: { select: { customerId: true, status: true } }, user: { select: { role: true, emailVerifiedAt: true, notificationPreferences: { where: { event: "job.priced", channel: "PUSH", enabled: true } } } } } });
          if (current.attempts >= MAX_ATTEMPTS || current.registration.revokedAt || current.registration.userId !== current.userId
            || current.job.customerId !== current.userId || current.job.status !== "PRICED" || current.user.role !== "CUSTOMER" || !current.user.emailVerifiedAt || !current.user.notificationPreferences.length) {
            await tx.priceReadyPushDelivery.updateMany({ where: { id: row.id, leaseToken }, data: { failedAt: at, leaseToken: null, leasedUntil: null } });
            return null;
          }
          return current;
        });
        if (!claim) { result.skipped++; continue; }
        // A lease is not a provider attempt. Budget aborts leave the real retry count unchanged.
        if (!enough()) {
          await context.db.priceReadyPushDelivery.updateMany({ where: { id: row.id, leaseToken }, data: { leaseToken: null, leasedUntil: null } });
          result.skipped++; continue;
        }
        const counted = await context.db.priceReadyPushDelivery.updateMany({ where: { id: row.id, leaseToken, attempts: claim.attempts, failedAt: null,
          registration: { userId: claim.userId, revokedAt: null }, job: { customerId: claim.userId, status: "PRICED" },
          user: { role: "CUSTOMER", emailVerifiedAt: { not: null }, notificationPreferences: { some: { event: "job.priced", channel: "PUSH", enabled: true } } },
        }, data: { attempts: { increment: 1 } } });
        if (!counted.count) { result.skipped++; continue; }
        if (!enough()) {
          await context.db.priceReadyPushDelivery.updateMany({ where: { id: row.id, leaseToken, attempts: claim.attempts + 1 }, data: { attempts: claim.attempts, leaseToken: null, leasedUntil: null } });
          result.skipped++; continue;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        let sent;
        try { sent = await Promise.race([sender(claim.registration.token, claim.id), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 10_000); })]); }
        finally { if (timer) clearTimeout(timer); }
        const at = now();
        await context.db.$transaction(async tx => {
          if (sent?.invalidToken) await tx.browserPushRegistration.updateMany({ where: { id: claim.registrationId, tokenHash: claim.registration.tokenHash }, data: { revokedAt: at } });
          const won = await tx.priceReadyPushDelivery.updateMany({ where: { id: row.id, leaseToken }, data: {
            leaseToken: null, leasedUntil: null, ...(sent?.accepted ? { deliveredAt: at } : sent?.invalidToken || claim.attempts + 1 >= MAX_ATTEMPTS ? { failedAt: at } : { dueAt: new Date(at.getTime() + 60_000 * 2 ** claim.attempts) }),
          } });
          if (won.count && sent?.accepted) await tx.notification.updateMany({ where: { id: claim.notificationId, NOT: { channelsSent: { has: "PUSH" } } }, data: { channelsSent: { push: "PUSH" } } });
        });
        if (sent?.accepted) result.done++; else result.failed++;
      } catch {
        result.failed++;
        // Unknown provider results retain the same opaque delivery id on retry. The display claim deduplicates it.
        await context.db.priceReadyPushDelivery.updateMany({ where: { id: row.id, leaseToken }, data: { leaseToken: null, leasedUntil: null, dueAt: new Date(now().getTime() + 60_000) } }).catch(() => {});
      }
    }
    return result;
  } };
}
export const priceReadyPush = createPriceReadyPushRule();
