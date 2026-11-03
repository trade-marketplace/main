import type { Metadata } from "next";
import { AccountSettings } from "@/components/account/AccountSettings";
import { TradesLicences } from "@/components/account/TradesLicences";
import { privateMetadata } from "@/lib/metadata";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { loadTrades } from "@/server/account/trades";

export const metadata: Metadata = { ...privateMetadata, title: "Trades & licences" };
export default async function TradesPage() {
  const viewer = await requireRole(["TRADIE"], { next: "/profile/trades" });
  let snapshot = null;
  try { snapshot = await loadTrades(getDb(), viewer.userId); } catch { /* A safe retry surface; no database details. */ }
  return <AccountSettings role="TRADIE" active="/profile/trades"><TradesLicences key={viewer.userId} initial={snapshot} /></AccountSettings>;
}
