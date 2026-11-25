import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import type { NotificationsResult } from "@/lib/notifications";
import { currentRole } from "@/server/messages/service";
import { loadNotificationsPage, markInboxRead } from "@/server/notifications/inbox";

export async function officeInbox(db: PrismaClient, userId: string, query: unknown, readId?: string | null): Promise<NotificationsResult> {
  return db.$transaction(async (tx) => {
    if (await currentRole(tx, { userId }) !== "ADMIN") return { ok: false, error: "forbidden" };
    if (readId !== undefined) await markInboxRead(tx, userId, readId);
    const inbox = await loadNotificationsPage(tx, userId, query);
    // Events shared with customers can have an app job link. Keep office readers in their shell.
    for (const item of inbox.items) {
      if (item.href.startsWith("/jobs/")) item.href = "/admin/jobs/" + item.href.split("/")[2];
      else if (!item.href.startsWith("/admin/")) item.href = "/admin/notifications#" + encodeURIComponent(item.id);
    }
    return { ok: true, inbox };
  });
}
