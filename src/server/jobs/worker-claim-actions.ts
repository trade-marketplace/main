"use server";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { claimWorkerJob } from "./worker-claim-command";
export const claimWorkerJobAction = withRole(["TRADIE"], (viewer, id: unknown) => claimWorkerJob(getDb(), viewer, id));
