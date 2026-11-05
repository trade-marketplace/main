import { z } from "zod";
import { customerJobWindowsReturn } from "./customer-job";

export function customerProblemReturn(id: string, value: unknown): string {
  const back = customerJobWindowsReturn(id, value);
  return back === "/notifications" ? `/jobs/${id}` : back;
}

export const customerProblemSchema = z.object({
  jobId: z.uuid(), topic: z.string().trim().min(1).max(160), details: z.string().trim().min(1).max(4000),
  urgent: z.boolean(), photoPaths: z.array(z.string().max(240)).max(6), requestKey: z.uuid(),
});
export type CustomerProblemInput = z.infer<typeof customerProblemSchema>;
export type CustomerProblemContext = { id: string; jobNumber: number; title: string };
export type CustomerProblemReceipt = { id: string; topic: string; details: string; urgent: boolean; photoCount: number; releasePaused: boolean };
export type CustomerProblemResult = { ok: true; report: CustomerProblemReceipt } | { ok: false; error: string; retryAfter?: number };
export type CustomerProblemState = "form" | "loading" | "empty" | "error" | "offline" | "uploading" | "saving" | "sent" | "urgent" | "photos";
export const CUSTOMER_PROBLEM_ERRORS: Readonly<Record<string, string>> = {
  invalid: "Add a topic and details.", forbidden: "This job isn’t available.",
  "try-later": "Too many requests. Try again shortly.", "photos-pending": "Your photo wasn’t uploaded. Try again.",
  unavailable: "Couldn’t send. Try again.", "photo-too-large": "That photo is too large. Choose a photo under 4 MB.",
};
