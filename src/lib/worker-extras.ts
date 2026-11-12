import type { VariationStatus } from "@/generated/prisma/client";

/** The complete worker wire shape: never include the customer's price. */
export type WorkerExtra = {
  id: string; status: VariationStatus; description: string; requestedMinutes: number;
  minutes: number | null; workerEarnsCents: number | null; photoCount: number; createdAt: string;
};
export const EXTRA_WORK_STATES = ["closed", "open", "uploading", "upload-error", "field-errors", "sending", "sent", "priced", "approved", "declined", "already-waiting", "try-later", "error", "offline", "loading", "empty"] as const;
export type ExtraWorkState = typeof EXTRA_WORK_STATES[number];
export type ExtraFields = { description: string; hours: string };
export function extraErrors(fields: ExtraFields, photoCount: number) {
  const errors: { description?: string; hours?: string; photos?: string } = {};
  if (fields.description.trim().length < 10 || fields.description.length > 2000) errors.description = "Describe the extra work in 10 to 2000 characters.";
  const hours = Number(fields.hours);
  if (!fields.hours.trim() || !Number.isFinite(hours) || hours <= 0 || hours > 100 || Math.abs(hours * 60 - Math.round(hours * 60)) > 1e-7) errors.hours = "Enter extra hours above 0 and up to 100, in whole minutes.";
  if (photoCount < 1 || photoCount > 6) errors.photos = "Add 1 to 6 photos of the extra work.";
  return errors;
}
/** A retry reuses the original key and exact payload, even if its first response was lost. */
export function extraRequest(jobId: string, requestKey: string, fields: ExtraFields, photoPaths: string[]) {
  return { jobId, requestKey, description: fields.description.trim(), hours: Number(fields.hours), photoPaths: [...photoPaths] };
}
