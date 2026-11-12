"use server";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { saveReview } from "./customer-review";

export const saveReviewAction = withRole(["CUSTOMER"], (viewer, jobId: string, input: unknown) => saveReview(getDb(), viewer, jobId, input));
