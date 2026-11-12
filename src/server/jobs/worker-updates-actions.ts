"use server";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { sendJobUpdate } from "./worker-updates";
export const sendJobUpdateAction = withRole(["TRADIE"], (viewer, jobId: unknown, kind: unknown, lateMinutes?: unknown) => sendJobUpdate(getDb(), viewer, jobId, kind, lateMinutes));
