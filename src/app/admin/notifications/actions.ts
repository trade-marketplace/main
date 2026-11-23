"use server";

import { revalidatePath } from "next/cache";
import type { NotificationsResult } from "@/lib/notifications";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { officeInbox } from "./inbox";

export const countOfficeNotifications = withRole(["ADMIN"], async (viewer) => {
  return getDb().notification.count({ where: { userId: viewer.userId, readAt: null } });
});

export const loadOfficeNotifications = withRole(["ADMIN"], async (viewer, query: unknown): Promise<NotificationsResult> => {
  try { return await officeInbox(getDb(), viewer.userId, query); }
  catch { return { ok: false, error: "unavailable" }; }
});

export const readOfficeNotifications = withRole(["ADMIN"], async (viewer, id: string | null, query: unknown): Promise<NotificationsResult> => {
  try {
    const result = await officeInbox(getDb(), viewer.userId, query, id);
    if (result.ok) revalidatePath("/admin", "layout");
    return result;
  } catch { return { ok: false, error: "unavailable" }; }
});
