"use client";
import { OfficeVariationPricing } from "@/components/office/OfficeVariationPricing";
import { VARIATION_PRICING_MESSAGES, type VariationPricingData, type VariationPreviewResult } from "@/lib/office-variation";
import type { VariationState } from "./preview-data";
export function PreviewClient({ data, state }: { data: VariationPricingData; state: VariationState }) {
  return <OfficeVariationPricing data={state === "error" || state === "loading" ? null : data} loading={state === "loading"} offline={state === "offline"}
    preview={async input => {
      const response = await fetch("/dev/components/office-variation-pricing/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...(input as object), state }) });
      return response.ok ? response.json() as Promise<VariationPreviewResult> : { ok: false, error: "unavailable" };
    }} publish={async () => state === "payment-pending" ? { ok: false, error: "payment-pending" } : { ok: true }} initialConfirm={state === "confirm"} initialSent={state === "sent"}
    initialChanged={state === "changed"} initialFailure={state === "payment-pending" ? VARIATION_PRICING_MESSAGES["payment-pending"] : undefined} />;
}
