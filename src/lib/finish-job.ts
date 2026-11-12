import { z } from "zod";
import type { Trade } from "@/generated/prisma/client";

export const FINISH_DECLARATION = "The work matches the job and any approved extras.";
export const FINISH_STATES = ["electrical", "other-trade", "no-budget", "over-budget", "uploading", "upload-error", "field-errors", "draft-saved", "sending", "sent", "waiting-extra", "not-configured", "read-only", "error", "offline", "loading", "load-error"] as const;
export type FinishState = typeof FINISH_STATES[number];
export type FinishRule = { cocRequired: boolean; cocFileRequired: boolean; minPhotos: number; notesRequired: boolean };
export const finishInputSchema = z.object({ cocNumber: z.string().max(200), notes: z.string().max(4000), spent: z.string().max(24), declaration: z.boolean(), reason: z.string().max(2000) }).strict();
export type FinishFields = z.infer<typeof finishInputSchema>;
export type FinishErrors = Partial<Record<keyof FinishFields | "photos" | "cocDocument" | "receipt" | "form", string>>;
export type FinishPhoto = { id: string; src: string; name: string };
export type FinishView = {
  id: string; ownerId: string; title: string; customerFirstName: string; category: Trade; autoReleaseHours: number;
  rule: FinishRule | null; fields: FinishFields; photos: FinishPhoto[]; cocDocument: { url: string; name: string; size?: number } | null;
  receipt: { url: string; name: string; size?: number } | null; budgetCents: number; extraWorkOpen: boolean; readOnly: boolean;
};
export type FinishResult = { status: "saved" | "sent" } | { status: "invalid"; fields: FinishErrors } | { status: "forbidden" | "unavailable" };
export type FinishUploadResult = { status: "uploaded"; file: { id: string; url: string; name: string; size: number } } | { status: "forbidden" | "unavailable" | "invalid"; message?: string };
export const emptyFinishFields = (): FinishFields => ({ cocNumber: "", notes: "", spent: "0", declaration: false, reason: "" });
export function finishSpend(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const cents = Math.round(Number(value) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= 2_147_483_647 ? cents : null;
}
export function finishErrors(fields: FinishFields, facts: { rule: FinishRule | null; photoCount: number; cocFile: boolean; receipt: boolean; budgetCents: number; category: Trade; extraWorkOpen: boolean }): FinishErrors {
  const errors: FinishErrors = {}, rule = facts.rule, spent = facts.budgetCents > 0 ? finishSpend(fields.spent) : 0;
  if (!rule) errors.form = "This trade isn’t set up for finishing jobs yet. Contact us.";
  if (facts.extraWorkOpen) errors.form = "Extra work is waiting on the customer’s OK.";
  if (rule?.cocRequired && !fields.cocNumber.trim()) errors.cocNumber = "Enter the CoC number.";
  if (rule?.cocFileRequired && !facts.cocFile) errors.cocDocument = "Add the CoC document.";
  if (rule && facts.photoCount < rule.minPhotos) errors.photos = `Add at least ${rule.minPhotos} ${rule.minPhotos === 1 ? "photo" : "photos"} of the finished work.`;
  if (rule?.notesRequired && !fields.notes.trim()) errors.notes = "Add notes about the finished work.";
  if (spent === null) errors.spent = "Enter the materials spend as $0 or more.";
  if (spent !== null && spent > 0 && facts.category !== "ELECTRICAL" && !facts.receipt) errors.receipt = "Add the materials receipt.";
  if (spent !== null && spent > facts.budgetCents && !fields.reason.trim()) errors.reason = "Tell us why it was over the budget.";
  if (!fields.declaration) errors.declaration = "Tick the declaration before sending.";
  return errors;
}

/** Same bounded owner-bound envelope pattern as the post-job draft; no reason enters customer-visible notes. */
export const finishReasonKey = (ownerId: string, jobId: string) => `trade.finish-reason.v1:${ownerId}:${jobId}`;
export function readFinishReason(raw: string | null, ownerId: string, jobId: string): string {
  try { const value = JSON.parse(raw ?? "null"); return value?.version === 1 && value.ownerId === ownerId && value.jobId === jobId && typeof value.reason === "string" && value.reason.length <= 2000 ? value.reason : ""; } catch { return ""; }
}
export function keepFinishReason(storage: Pick<Storage, "setItem" | "getItem">, ownerId: string, jobId: string, reason: string): boolean {
  try { const raw = JSON.stringify({ version: 1, ownerId, jobId, reason: reason.slice(0, 2000) }), key = finishReasonKey(ownerId, jobId); storage.setItem(key, raw); return storage.getItem(key) === raw; } catch { return false; }
}
export function clearFinishReason(storage: Pick<Storage, "removeItem" | "getItem">, ownerId: string, jobId: string): boolean {
  try { const key = finishReasonKey(ownerId, jobId); storage.removeItem(key); return storage.getItem(key) === null; } catch { return false; }
}
