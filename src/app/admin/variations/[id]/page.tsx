import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { OfficeVariationPricingClient } from "@/components/office/OfficeVariationPricingClient";
import { UUID } from "@/lib/office-pricing";
import { variationPricingHref, variationQueueReturn, type VariationPricingData } from "@/lib/office-variation";
import { requireRole } from "@/server/auth/guard";
import { DatabaseNotConfiguredError, getDb } from "@/server/db";
import { readVariationPricing } from "@/server/office/variation-read";

export const metadata: Metadata = { title: "Price extra work" };
export default async function VariationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params, query = await searchParams, back = variationQueueReturn(query.from);
  const viewer = await requireRole(["ADMIN"], { next: variationPricingHref(encodeURIComponent(id), back) });
  if (!UUID.test(id)) notFound();
  let data: VariationPricingData | null = null;
  try { data = await readVariationPricing(getDb(), viewer, id); if (!data) notFound(); }
  catch (error) { unstable_rethrow(error); if (!(error instanceof DatabaseNotConfiguredError)) console.error("Office extra work could not load."); }
  return <OfficeVariationPricingClient data={data} back={back} />;
}
