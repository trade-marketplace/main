import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { OfficePricingClient } from "@/components/office/OfficePricingClient";
import { priceWorkspaceHref, UUID, type PricingWorkspace } from "@/lib/office-pricing";
import { requireRole } from "@/server/auth/guard";
import { DatabaseNotConfiguredError, getDb } from "@/server/db";
import { readPricingWorkspace } from "@/server/office/pricing-read";
export const metadata: Metadata = { title: "Price a job" };
export default async function PriceJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params, viewer = await requireRole(["ADMIN"], { next: priceWorkspaceHref(encodeURIComponent(id)) });
  if (!UUID.test(id)) notFound();
  let data: PricingWorkspace | null = null;
  try { data = await readPricingWorkspace(getDb(), viewer, id); if (!data) notFound(); }
  catch (error) { unstable_rethrow(error); if (!(error instanceof DatabaseNotConfiguredError)) console.error("Office pricing: could not read the workspace."); }
  return <OfficePricingClient data={data} />;
}
