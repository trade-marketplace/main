"use client";
import { OfficePricing } from "@/components/office/OfficePricing";
import { PRICING_MESSAGES, type PricingWorkspace, type PreviewResult } from "@/lib/office-pricing";
import type { PriceState } from "./preview-data";
async function previewDemoPrice(input: unknown): Promise<PreviewResult> {
  const response = await fetch("/dev/components/office-pricing/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  return response.ok ? response.json() : { ok: false, error: "unavailable" };
}
async function publishDemoPrice() { return { ok: true as const }; }
export function PreviewClient({ data, state }: { data: PricingWorkspace; state: PriceState }) {
  return <OfficePricing data={state === "error" || state === "loading" ? null : data} loading={state === "loading"} offline={state === "offline"}
    preview={raw => previewDemoPrice({ ...(raw as object), state })} publish={publishDemoPrice} requestPhotos={publishDemoPrice}
    initialDialog={state === "confirm" ? "confirm" : state === "photos" ? "photos" : state === "site-visit" ? "visit" : undefined}
    initialError={state === "changed" ? PRICING_MESSAGES.changed : undefined} initialSent={state === "sent"} />;
}
