import { z } from "zod";
import { jobDraftSchema } from "./job-draft";

export const customerJobDetailsSchema = z.object({
  title: z.string().trim().min(1, "Job title").max(200, "Job title"),
  description: jobDraftSchema.shape.description.unwrap(),
  accessNotes: z.string().trim().max(1000, "Anything else? (optional)"),
}).strict();
export type CustomerJobDetails = z.infer<typeof customerJobDetailsSchema>;
/** Include the editable content so changes within the same timestamp millisecond still conflict. */
export function waitingJobRevision(updatedAt: string, details: CustomerJobDetails) {
  return JSON.stringify([updatedAt, details.title, details.description, details.accessNotes]);
}
export type WaitingJobResult = { status: "saved" | "cancelled" | "changed" | "forbidden" | "unavailable" } | { status: "invalid"; fields: Partial<Record<keyof CustomerJobDetails, string>> };
export const CUSTOMER_PRICE_DELAY_MS = 24 * 60 * 60 * 1000;
export function customerPriceDelayed(ageMs: number) { return ageMs > CUSTOMER_PRICE_DELAY_MS; }
