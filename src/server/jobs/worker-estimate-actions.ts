"use server";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { submitWorkerEstimate } from "./worker-estimate";
export const saveWorkerEstimateAction = withRole(["TRADIE"], async (viewer, id: string, input: unknown) => submitWorkerEstimate(getDb(), viewer, id, input));
