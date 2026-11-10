"use server";

import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { markSupportThreadRead, sendSupportMessage } from "@/server/messages/support";

export const sendOfficeSupportMessageAction = withRole(["ADMIN"], (actor, id: string, input: unknown) => sendSupportMessage(getDb(), actor, id, input));
export const markOfficeSupportReadAction = withRole(["ADMIN"], async (actor, id: string, messageId: string) => {
  try { await markSupportThreadRead(getDb(), actor, id, messageId); return { ok: true } as const; }
  catch { return { ok: false, error: "unavailable" } as const; }
});
