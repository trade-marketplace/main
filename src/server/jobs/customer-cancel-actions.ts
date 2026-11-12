"use server";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { cancelJob } from "./customer-cancel";

export const cancelJobAction = withRole(["CUSTOMER"], (viewer, jobId: string, revision: string, reason?: string) => cancelJob(getDb(), viewer, jobId, revision, reason));
