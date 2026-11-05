"use client";
import type { VariationPricingData } from "@/lib/office-variation";
import { previewOfficeVariationAction, publishOfficeVariationAction } from "@/server/office/variation-actions";
import { OfficeVariationPricing } from "./OfficeVariationPricing";
export function OfficeVariationPricingClient({ data, back, loading }: { data: VariationPricingData | null; back: string; loading?: boolean }) {
  return <OfficeVariationPricing key={data?.id ?? "error"} data={data} back={back} loading={loading} preview={previewOfficeVariationAction} publish={publishOfficeVariationAction} />;
}
