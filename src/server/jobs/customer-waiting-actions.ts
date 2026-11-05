"use server";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { changeWaitingJob } from "./customer-waiting";

export const saveWaitingJobAction = withRole(["CUSTOMER"], (viewer, id: string, revision: string, input: unknown) => changeWaitingJob(getDb(), viewer, id, revision, "edit", input));
export const cancelWaitingJobAction = withRole(["CUSTOMER"], (viewer, id: string, revision: string) => changeWaitingJob(getDb(), viewer, id, revision, "cancel"));
