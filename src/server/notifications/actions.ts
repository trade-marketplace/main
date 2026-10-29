"use server";

import type { InboxResult } from "@/lib/notifications";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";

import { loadInbox, readInbox } from "./inbox";

export const loadNotificationsAction = withRole(["CUSTOMER", "TRADIE"], async (viewer): Promise<InboxResult> => {
  try { return { ok: true, inbox: await loadInbox(getDb(), viewer.userId) }; }
  catch { console.error("Notification inbox unavailable"); return { ok: false, error: "unavailable" }; }
});

export const readNotificationsAction = withRole(["CUSTOMER", "TRADIE"], async (viewer, id: string | null): Promise<InboxResult> => {
  try { return { ok: true, inbox: await readInbox(getDb(), viewer.userId, id) }; }
  catch { console.error("Notification read unavailable"); return { ok: false, error: "unavailable" }; }
});
