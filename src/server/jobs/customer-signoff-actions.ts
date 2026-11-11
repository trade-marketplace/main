"use server";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import type { SignoffRevision } from "@/lib/customer-signoff";
import { signOffJob } from "./customer-signoff";

export const signOffJobAction = withRole(["CUSTOMER"], (viewer, jobId: string, revision: SignoffRevision, review?: unknown) => signOffJob(getDb(), viewer, jobId, revision, review));
