import type { JobStatus } from "@/generated/prisma/enums";

export const PRICING_PATH = "/admin/jobs";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type PriceFields = { hours: string; materials: string };
export type PricingPreview = {
  inputKey: string; token: string;
  exGst: string; gst: string; total: string; workerEarns: string; materials: string; margin: string;
  gstLabel: string; minimum: string | null;
  customer: { title: string; suburb: string; total: string; gst: string };
};
export type PricingEstimate = {
  id: string; name: string; record: string; hours: string; materials: string; note: string | null;
  stale: boolean; needsSiteVisit: boolean;
};
export type PricingWorkspace = {
  id: string; number: string; title: string; trade: string; suburb: string; description: string; accessNotes: string | null;
  status: JobStatus; posted: string; asap: boolean; canPrice: boolean;
  photos: { src: string; alt: string }[]; photosFailed: boolean;
  estimates: PricingEstimate[]; spread: string | null; suggestion: string | null; trimmed: boolean;
  siteVisitRequested: boolean; noEstimatesAfterDay: boolean;
  fields: PriceFields; preview: PricingPreview | null;
};
export type PricingError = "invalid" | "not-found" | "frozen" | "changed" | "unavailable" | "session-expired" | "forbidden" | "limited";
export type PricingFailure = { ok: false; error: PricingError; field?: keyof PriceFields | "body"; message?: string };
export type PreviewResult = { ok: true; preview: PricingPreview } | PricingFailure;
export type PublishResult = { ok: true } | PricingFailure;
export const PRICING_MESSAGES = {
  invalid: "Check the highlighted fields.",
  "not-found": "This job is no longer available.",
  frozen: "This job can’t be priced here any more.",
  changed: "The job or its rates changed. Check the latest breakdown before sending.",
  unavailable: "Couldn’t save that. Nothing was changed. Try again.",
  "session-expired": "You’ve been logged out.",
  forbidden: "You’re not able to do that. Log in again, or ask for office access.",
  limited: "Too many tries. Try again in a moment.",
} satisfies Record<PricingError, string>;
export const inputKey = (fields: PriceFields) => JSON.stringify([fields.hours, fields.materials]);
export const priceWorkspaceHref = (id: string) => `${PRICING_PATH}/${id}/price`;
