"use server";

import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { markThreadRead, openProblemThread, sendProblemMessage } from "./service";

export const openProblemThreadAction = withRole(["CUSTOMER", "TRADIE"], async (viewer, input: unknown) => openProblemThread(getDb(), viewer, input));
export const sendProblemMessageAction = withRole(["CUSTOMER", "TRADIE"], async (viewer, threadId: string, input: unknown) => sendProblemMessage(getDb(), viewer, threadId, input));
export const markProblemThreadReadAction = withRole(["CUSTOMER", "TRADIE"], async (viewer, threadId: string, messageId: string) => {
  try { await markThreadRead(getDb(), viewer, threadId, messageId); return { ok: true } as const; }
  catch { return { ok: false, error: "unavailable" } as const; }
});
