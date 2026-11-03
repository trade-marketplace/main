"use server";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { saveJobWindows } from "./windows";
export const saveJobWindowsAction = withRole(["CUSTOMER"], async (viewer, id: string, input: unknown, revision: string) => {
  try { return await saveJobWindows(getDb(), viewer, id, input, revision); }
  catch { return { status: "unavailable" } as const; }
});
