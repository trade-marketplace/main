import { z } from "zod";
import type { JobStatus } from "@/generated/prisma/enums";

export type CancelFacts = { canCancel: boolean; paid: boolean; workerFirstName: string | null; onTheWay: boolean };
export const canCancelJob = (status: JobStatus) => ["REVIEW", "QUOTE_BOUNTY", "BOOKABLE", "ASSIGNED"].includes(status);
export const cancelReasonSchema = z.string().trim().min(3, "Tell us why.").max(500, "Use 500 characters or fewer.");
export const cancelRevision = (updatedAt: string, status: JobStatus) => JSON.stringify([updatedAt, status]);
export type CancelResult = { status: "cancelled" | "requested" | "changed" | "forbidden" | "unavailable" } | { status: "invalid"; reason: string };
export const CANCEL_REQUESTED_MESSAGE = "Cancel requested. We’ll reply within 1 working day.";
