import { OfficeVariationPricingClient } from "@/components/office/OfficeVariationPricingClient";
import { EXTRA_WORK_QUEUE } from "@/lib/office-variation";
export default function Loading() { return <OfficeVariationPricingClient data={null} back={EXTRA_WORK_QUEUE} loading />; }
