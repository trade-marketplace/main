import type { Metadata } from "next";
import { AccountSettings } from "@/components/account/AccountSettings";
import { TradesLicences } from "@/components/account/TradesLicences";
import { TextLink } from "@/components/TextLink";
import { boardSettingsRoute } from "@/lib/job-board";
import { privateMetadata } from "@/lib/metadata";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { loadTrades } from "@/server/account/trades";

export const metadata: Metadata = { ...privateMetadata, title: "Trades & licences" };
export default async function TradesPage({ searchParams }: { searchParams: Promise<{ next?: unknown }> }) {
  const destination = boardSettingsRoute("/profile/trades", (await searchParams).next);
  const viewer = await requireRole(["TRADIE"], { next: destination.href });
  let snapshot = null;
  try { snapshot = await loadTrades(getDb(), viewer.userId); } catch { /* A safe retry surface; no database details. */ }
  return <AccountSettings role="TRADIE" active="/profile/trades">{destination.back && <TextLink href={destination.back}>Back to jobs</TextLink>}<TradesLicences key={viewer.userId} initial={snapshot} /></AccountSettings>;
}
