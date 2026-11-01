import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { InboxItem, InboxSnapshot } from "@/lib/notifications";
import { NOTIFICATIONS_PAGE_SIZE, notificationsQuery, type NotificationsPage } from "@/lib/notifications";

export type InboxDb = Pick<Prisma.TransactionClient, "notification">;
const SELECT = { id: true, type: true, payload: true, createdAt: true, readAt: true } as const;
type Row = Prisma.NotificationGetPayload<{ select: typeof SELECT }>;

const COPY: Readonly<Record<string, readonly [string, string]>> = {
  "job.posted": ["Job posted", "task_alt"],
  "job.priced": ["Your price is ready", "sell"],
  "job.paid": ["Payment received", "receipt_long"],
  "job.claimed": ["Tradie confirmed", "person_check"],
  "job.window_booked": ["Time booked", "event_available"],
  "job.on_my_way": ["On the way", "local_shipping"],
  "job.running_late": ["Running late", "schedule"],
  "job.reschedule_requested": ["New time requested", "event_repeat"],
  "variation.requested": ["Extra work requested", "add_circle"],
  "variation.priced": ["Extra-work price ready", "sell"],
  "variation.approved": ["Extra work approved", "task_alt"],
  "variation.declined": ["Extra work declined", "cancel"],
  "job.submitted": ["Please check", "task_alt"],
  "job.signed_off": ["All sorted", "task_alt"],
  "job.auto_completed": ["Job completed", "task_alt"],
  "job.cancel_requested": ["Cancellation requested", "cancel"],
  "job.cancelled": ["Job cancelled", "cancel"],
  "job.reinstated": ["Job reopened", "restart_alt"],
  "job.status_overridden": ["Job updated", "update"],
  "payout.queued": ["Payout queued", "payments"],
  "payout.paid": ["Payout paid", "payments"],
  "bounty.available": ["Quote bounty available", "stars"],
  "crew.invited": ["Crew invitation", "group_add"],
  "licence.verified": ["Licence checked", "verified"],
  "licence.rejected": ["Check your licence", "badge"],
  "message.received": ["New message", "chat_bubble"],
};

function identifier(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) ? value : null;
}

/** Only server-selected fields reach the UI. Payload URLs, prices and arbitrary HTML are never forwarded. */
export function inboxItem(row: Row): InboxItem {
  const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {};
  const jobId = identifier(payload.jobId);
  const [label, icon] = Object.hasOwn(COPY, row.type) ? COPY[row.type] : ["Notification", "notifications"];
  const title = typeof payload.jobTitle === "string" ? payload.jobTitle.trim() : "";
  let href = `/notifications#${encodeURIComponent(row.id)}`;
  if (row.type.startsWith("payout.")) href = "/earnings";
  else if (row.type.startsWith("licence.")) href = "/profile/trades";
  else if (jobId) {
    if (row.type === "message.received") href = `/messages/${encodeURIComponent(jobId)}`;
    else if (row.type === "job.paid") href = `/receipts/${encodeURIComponent(jobId)}`;
    else href = `/jobs/${encodeURIComponent(jobId)}`;
  }
  return { id: row.id, line: title ? `${label} · ${title}` : label, icon, href, createdAt: row.createdAt.toISOString(), readAt: row.readAt?.toISOString() ?? null };
}

export async function loadInbox(db: InboxDb, userId: string): Promise<InboxSnapshot> {
  const [rows, unread] = await Promise.all([
    db.notification.findMany({ where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 8, select: SELECT }),
    db.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { items: rows.map(inboxItem), unread };
}

/** Ownership is part of the write predicate; an unknown/foreign id is indistinguishable from an already-read id. */
export async function readInbox(db: InboxDb, userId: string, id: string | null, now = new Date()): Promise<InboxSnapshot> {
  await markInboxRead(db, userId, id, now);
  return loadInbox(db, userId);
}

export async function markInboxRead(db: InboxDb, userId: string, id: string | null, now = new Date()): Promise<void> {
  if (id !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("Invalid notification id");
  await db.notification.updateMany({ where: { userId, readAt: null, ...(id === null ? { createdAt: { lte: now } } : { id }) }, data: { readAt: now } });
}

/** Full owned inbox; the bell deliberately keeps its separate eight-row limit. */
export async function loadNotificationsPage(db: InboxDb, userId: string, input: unknown): Promise<NotificationsPage> {
  const query = notificationsQuery(input);
  const where = { userId, ...(query.filter === "unread" ? { readAt: null } : {}) };
  const [total, unread] = await Promise.all([
    db.notification.count({ where }), db.notification.count({ where: { userId, readAt: null } }),
  ]);
  const page = Math.min(query.page, Math.max(1, Math.ceil(total / NOTIFICATIONS_PAGE_SIZE)));
  const rows = await db.notification.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * NOTIFICATIONS_PAGE_SIZE, take: NOTIFICATIONS_PAGE_SIZE, select: SELECT });
  return { items: rows.map(inboxItem), unread, total, page };
}
