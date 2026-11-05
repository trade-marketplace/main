import type { VariationStatus } from "@/generated/prisma/enums";
import type { PriceFields, PricingPreview } from "./office-pricing";
import { parseQueueQuery, queueHref } from "./office-queues";

export type VariationPricingData = {
  id: string; jobId: string; number: string; title: string; trade: string; suburb: string;
  description: string; requester: string; requestedHours: string; requestedMaterials: string;
  status: VariationStatus; revision: number; canPrice: boolean; fields: PriceFields;
  photos: { src: string; alt: string }[]; photosFailed: boolean; preview: PricingPreview | null;
};
export type VariationPricingError = "invalid" | "not-found" | "forbidden" | "changed" | "not-in-progress" | "payment-pending" | "unavailable" | "session-expired";
export type VariationPricingFailure = { ok: false; error: VariationPricingError; field?: keyof PriceFields; message?: string };
export type VariationPreviewResult = { ok: true; preview: PricingPreview } | VariationPricingFailure;
export type VariationPublishResult = { ok: true } | VariationPricingFailure;
export const VARIATION_PRICING_MESSAGES = {
  invalid: "Check the highlighted fields.",
  "not-found": "This extra work is no longer available.",
  forbidden: "You’re not able to do that. Log in again, or ask for office access.",
  changed: "The extra work changed. Check the latest breakdown before sending.",
  "not-in-progress": "Extra work can only be priced while the job is in progress.",
  "payment-pending": "A payment is being checked. Try again in a moment.",
  unavailable: "Couldn’t save. Try again.",
  "session-expired": "You’ve been logged out.",
} satisfies Record<VariationPricingError, string>;
export const VARIATION_STATUS_LABELS: Record<VariationStatus, string> = { REQUESTED: "Requested", PRICED: "Price ready", APPROVED: "Approved", DECLINED: "Declined" };
export const EXTRA_WORK_QUEUE = "/admin?tab=extra";
/** Only a bounded office queue may be a return destination; no nested or external redirects. */
export function variationQueueReturn(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 600 || !raw.startsWith("/admin?") || /[\\\r\n]/.test(raw)) return EXTRA_WORK_QUEUE;
  try {
    const url = new URL(raw, "https://queue.invalid");
    if (url.origin !== "https://queue.invalid" || url.pathname !== "/admin" || url.hash) return EXTRA_WORK_QUEUE;
    for (const key of url.searchParams.keys()) if (!["tab", "q", "page", "problemPage"].includes(key) || url.searchParams.getAll(key).length !== 1) return EXTRA_WORK_QUEUE;
    const query = parseQueueQuery(url.searchParams);
    return query.tab === "extra" && query.page <= 1_000_000 ? queueHref(query) : EXTRA_WORK_QUEUE;
  } catch { return EXTRA_WORK_QUEUE; }
}
export const variationPricingHref = (id: string, back?: string) => `/admin/variations/${id}${back ? `?${new URLSearchParams({ from: variationQueueReturn(back) })}` : ""}`;
