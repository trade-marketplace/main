"use server";

import type { InboxResult } from "@/lib/notifications";
import type { NotificationsResult } from "@/lib/notifications";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";

import { loadInbox, loadNotificationsPage, markInboxRead, readInbox } from "./inbox";

export const loadNotificationsAction = withRole(["CUSTOMER", "TRADIE"], async (viewer): Promise<InboxResult> => {
  try { return { ok: true, inbox: await loadInbox(getDb(), viewer.userId) }; }
  catch { console.error("Notification inbox unavailable"); return { ok: false, error: "unavailable" }; }
});

export const readNotificationsAction = withRole(["CUSTOMER", "TRADIE"], async (viewer, id: string | null): Promise<InboxResult> => {
  try { return { ok: true, inbox: await readInbox(getDb(), viewer.userId, id) }; }
  catch { console.error("Notification read unavailable"); return { ok: false, error: "unavailable" }; }
});

export const loadNotificationsPageAction = withRole(["CUSTOMER", "TRADIE"], async (viewer, query: unknown): Promise<NotificationsResult> => {
  try { return { ok: true, inbox: await loadNotificationsPage(getDb(), viewer.userId, query) }; }
  catch { console.error("Notification page unavailable"); return { ok: false, error: "unavailable" }; }
});

export const readNotificationsPageAction = withRole(["CUSTOMER", "TRADIE"], async (viewer, id: string | null, query: unknown): Promise<NotificationsResult> => {
  try {
    const db = getDb();
    await markInboxRead(db, viewer.userId, id);
    return { ok: true, inbox: await loadNotificationsPage(db, viewer.userId, query) };
  } catch { console.error("Notification read unavailable"); return { ok: false, error: "unavailable" }; }
});
