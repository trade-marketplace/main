"use server";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { signOffJob } from "./customer-signoff";

export const signOffJobAction = withRole(["CUSTOMER"], (viewer, jobId: string, revision: string, review?: unknown) => signOffJob(getDb(), viewer, jobId, revision, review));
