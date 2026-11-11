import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountSettings } from "@/components/account/AccountSettings";
import { WorkArea } from "@/components/account/WorkArea";
import { TextLink } from "@/components/TextLink";
import { boardSettingsRoute } from "@/lib/job-board";
import { privateMetadata } from "@/lib/metadata";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { publicMapboxToken } from "@/server/geo/mapbox-config";
import { loadWorkArea } from "@/server/workers/area";

export const metadata: Metadata = { ...privateMetadata, title: "Work area" };
export default async function WorkAreaPage({ searchParams }: { searchParams: Promise<{ next?: unknown }> }) {
  const destination = boardSettingsRoute("/profile/area", (await searchParams).next);
  const viewer = await requireUser({ next: destination.href });
  if (viewer.role !== "TRADIE") notFound();
  let snapshot = null;
  try { snapshot = await loadWorkArea(getDb(), viewer); } catch { /* Safe retry surface. */ }
  return <AccountSettings role="TRADIE" active="/profile/area">
    {destination.back && <TextLink href={destination.back}>Back to jobs</TextLink>}
    <WorkArea key={viewer.userId} initial={snapshot} accessToken={publicMapboxToken()} />
  </AccountSettings>;
}
