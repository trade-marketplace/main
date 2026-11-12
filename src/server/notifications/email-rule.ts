import "server-only";

import { z } from "zod";

import { Prisma, type Licence } from "@/generated/prisma/client";
import { resendMailer, type ContactMailer } from "@/server/contact";
import { databaseSchema } from "@/server/database-client";
import { licenceReviewVersion } from "@/server/office/tradie-commands";
import type { SchedulerContext, SchedulerRule } from "@/server/scheduler/rules";
import { customerJobView, JOB_DETAIL_SELECT } from "@/server/views/jobs";

import { notificationEmail, type NotificationEmail, type NotificationEmailEvent } from "./email-templates";
import { notificationId } from "./notify";

const EVENTS = ["job.priced", "job.submitted", "licence.verified"] as const;
const RETRY_WINDOW_MS = 60 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 10000;
const MIN_REMAINING_MS = 12000;
type Tx = Prisma.TransactionClient;
const jobPayload = z.object({ jobId: z.uuid() });
const beforeCheck = z.object({ status: z.literal("PENDING"), checkedAt: z.iso.datetime().nullable(), checkedById: z.uuid().nullable() });
const afterCheck = z.object({ status: z.literal("VERIFIED"), checkedAt: z.iso.datetime(), checkedById: z.uuid() });

/** The current producer omits its event id/payload. Never infer the licence from clock proximity or trade order. */
async function licenceFacts(tx: Tx, id: string, userId: string, to: string): Promise<NotificationEmail | null> {
  const licences = await tx.licence.findMany({ where: { userId, status: "VERIFIED" }, orderBy: { id: "asc" } });
  if (!licences.length) return null;
  const audits = await tx.auditLog.findMany({ where: { action: "licence.verified", recordType: "licences", actorRole: "ADMIN", recordId: { in: licences.map(licence => licence.id) } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100, select: { recordId: true, actorId: true, before: true, after: true } });
  const proven = new Map<string, Licence>();
  for (const licence of licences) for (const audit of audits) {
    if (audit.recordId !== licence.id) continue;
    const before = beforeCheck.safeParse(audit.before), after = afterCheck.safeParse(audit.after);
    if (!before.success || !after.success || audit.actorId !== after.data.checkedById
      || licence.checkedById !== after.data.checkedById || licence.checkedAt?.toISOString() !== after.data.checkedAt) continue;
    // First submissions can retain their creation clock. A resubmission/clock history that cannot reproduce
    // the real event's deterministic notification id is deliberately unsupported, rather than guessed.
    const version = licenceReviewVersion({ ...licence, status: "PENDING", updatedAt: licence.createdAt,
      checkedAt: before.data.checkedAt ? new Date(before.data.checkedAt) : null, checkedById: before.data.checkedById });
    if (notificationId(`licence.verified:${licence.id}:${version}`, userId) === id) proven.set(licence.id, licence);
  }
  if (proven.size !== 1) return null;
  const licence = [...proven.values()][0];
  if (licence.trade === "OTHER") return null;
  return notificationEmail("licence.verified", { to, trade: licence.trade });
}

async function freshMessage(tx: Tx, event: NotificationEmailEvent, row: { id: string; userId: string; payload: Prisma.JsonValue }, to: string): Promise<NotificationEmail | null> {
  if (event === "licence.verified") return licenceFacts(tx, row.id, row.userId, to);
  const payload = jobPayload.safeParse(row.payload);
  if (!payload.success) return null;
  // Coalesce existing notices for the same recipient/event/job, including ones already claimed.
  // This order selects one delivery of fresh facts; it does not prove a producer transaction's origin.
  const latest = await tx.notification.findFirst({ where: { userId: row.userId, type: event, payload: { path: ["jobId"], equals: payload.data.jobId } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
  if (latest?.id !== row.id) return null;
  const source = await tx.job.findUnique({ where: { id: payload.data.jobId }, select: JOB_DETAIL_SELECT });
  const view = source && customerJobView({ userId: row.userId, role: "CUSTOMER" }, source);
  if (!view || view.status !== (event === "job.priced" ? "PRICED" : "SUBMITTED")) return null;
  const job = { to, jobId: view.id, jobNumber: view.jobNumber, title: view.title };
  if (event === "job.priced") return view.priceCents === null ? null : notificationEmail(event, { ...job, priceCents: view.priceCents });
  if (!view.worker?.firstName) return null;
  const settings = await tx.settings.findUnique({ where: { id: 1 }, select: { autoReleaseHours: true } });
  return settings ? notificationEmail(event, { ...job, firstName: view.worker.firstName, autoReleaseHours: settings.autoReleaseHours }) : null;
}

/** Atomic removal preserves a PUSH delivery that completed while the mail provider was running. */
async function releaseEmail(context: SchedulerContext, id: string) {
  const table = Prisma.raw(`"${databaseSchema(context.db).replaceAll('"', '""')}"."notifications"`);
  await context.db.$executeRaw(Prisma.sql`UPDATE ${table} SET channels_sent = array_remove(channels_sent, 'EMAIL') WHERE id = ${id}::uuid`);
}

async function sendWithinBudget(mailer: ContactMailer, message: NotificationEmail, key: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([mailer(message, key), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), PROVIDER_TIMEOUT_MS); })]);
  } finally { clearTimeout(timer); }
}

export function createNotificationEmailRule(options: { mailer?: ContactMailer | null; wallClock?: () => number } = {}): SchedulerRule {
  return { name: "notification-email", async run(context) {
    const result = { rule: "notification-email", due: 0, done: 0, skipped: 0, failed: 0 };
    const mailer = options.mailer === undefined ? resendMailer() : options.mailer;
    const clock = options.wallClock ?? Date.now, started = clock();
    const deadline = context.deadlineAt?.getTime() ?? started + 15000;
    const enough = () => deadline - clock() >= MIN_REMAINING_MS;
    const now = () => new Date(context.now.getTime() + Math.max(0, clock() - started));
    const limit = Number.isFinite(context.limit) ? Math.max(0, Math.min(5, Math.floor(context.limit))) : 0;
    if (!mailer || !limit || !enough()) return result;
    for (const event of EVENTS) {
      if (!enough()) break;
      const role = event === "licence.verified" ? "TRADIE" as const : "CUSTOMER" as const;
      const eligible = () => ({ type: event, createdAt: { gte: new Date(now().getTime() - RETRY_WINDOW_MS), lte: now() }, NOT: { channelsSent: { has: "EMAIL" as const } },
        user: { role, emailVerifiedAt: { not: null }, notificationPreferences: { none: { event, channel: "EMAIL" as const, enabled: false } } } });
      const rows = await context.db.notification.findMany({ where: eligible(), orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit, select: { id: true } });
      result.due += rows.length;
      for (const row of rows) {
        if (!enough()) { result.skipped++; continue; }
        try {
          const message = await context.db.$transaction(async tx => {
            const current = await tx.notification.findUnique({ where: { id: row.id }, include: { user: { select: { role: true, email: true, emailVerifiedAt: true,
              notificationPreferences: { where: { event, channel: "EMAIL", enabled: false }, select: { enabled: true } } } } } });
            if (!current || current.type !== event || current.user.role !== role || !current.user.emailVerifiedAt || current.user.notificationPreferences.length) return null;
            const claimed = await tx.notification.updateMany({ where: { id: row.id, ...eligible() }, data: { channelsSent: { push: "EMAIL" } } });
            if (!claimed.count) return null;
            try { return await freshMessage(tx, event, current, current.user.email); }
            catch (error) { if (error instanceof z.ZodError) return null; throw error; }
          }, { timeout: 2000, maxWait: 1000 });
          if (!message) { result.skipped++; continue; }
          if (!enough()) { await releaseEmail(context, row.id); result.skipped++; continue; }
          let accepted = false;
          try { accepted = await sendWithinBudget(mailer, message, `${row.id}:EMAIL`); }
          catch { /* Provider errors may contain private addresses or bodies. */ }
          if (accepted) result.done++;
          else { await releaseEmail(context, row.id); result.failed++; }
        } catch { result.failed++; }
      }
    }
    if (result.failed) console.error("Notification email delivery", { due: result.due, done: result.done, skipped: result.skipped, failed: result.failed });
    return result;
  } };
}

export const notificationEmailRule = createNotificationEmailRule();
