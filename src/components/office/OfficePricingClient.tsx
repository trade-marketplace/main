"use client";
import type { PricingWorkspace } from "@/lib/office-pricing";
import { previewOfficePriceAction, publishOfficePriceAction, requestPricingPhotosAction } from "@/server/office/pricing-actions";
import { OfficePricing } from "./OfficePricing";
export function OfficePricingClient({ data, loading = false }: { data: PricingWorkspace | null; loading?: boolean }) {
  return <OfficePricing key={data?.id ?? "error"} data={data} loading={loading} preview={previewOfficePriceAction} publish={publishOfficePriceAction} requestPhotos={requestPricingPhotosAction} />;
}
