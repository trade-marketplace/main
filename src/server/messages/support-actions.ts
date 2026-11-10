"use server";

import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { markSupportThreadRead, openSupportThread, sendSupportMessage } from "./support";

export const openSupportThreadAction = withRole(["CUSTOMER", "TRADIE"], async (viewer, input: unknown) => openSupportThread(getDb(), viewer, input));
export const sendSupportMessageAction = withRole(["CUSTOMER", "TRADIE", "ADMIN"], async (viewer, id: string, input: unknown) => sendSupportMessage(getDb(), viewer, id, input));
export const markSupportThreadReadAction = withRole(["CUSTOMER", "TRADIE", "ADMIN"], async (viewer, id: string, messageId: string) => {
  try { await markSupportThreadRead(getDb(), viewer, id, messageId); return { ok: true } as const; }
  catch { return { ok: false, error: "unavailable" } as const; }
});
