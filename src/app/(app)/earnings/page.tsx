// /earnings (#165, D12): the signed-in tradie's money. Tradies only: the proxy redirects everyone else, and this
// checks again because it reads their payouts. `?state=empty|loading|error` opens the states real data can't show.
import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";

import { Earnings } from "@/components/earnings/Earnings";
import { buildEarnings, earningsHref, parseEarningsQuery } from "@/lib/earnings";
import { privateMetadata } from "@/lib/metadata";
import { requireRole } from "@/server/auth/guard";
import { DatabaseNotConfiguredError, getDb } from "@/server/db";
import { type EarningsData, loadEarnings } from "@/server/earnings/load";

export const metadata: Metadata = { ...privateMetadata, title: "Earnings" };

export default async function EarningsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseEarningsQuery(await searchParams);
  const viewer = await requireRole(["TRADIE"], { next: earningsHref(query) });

  if (query.state === "loading") return <Earnings view={null} loading flag="loading" />;
  if (query.state === "error") return <Earnings view={null} flag="error" />;
  if (query.state === "empty") {
    const view = buildEarnings({ payouts: [], waiting: [], now: new Date() });
    return <Earnings view={view} flag="empty" payroll={query.payroll} />;
  }

  let data: EarningsData | null = null;
  try {
    data = await loadEarnings(getDb(), viewer.userId);
  } catch (error) {
    unstable_rethrow(error);
    // Shown as "Can’t load your earnings" with Try again; the details stay in the server log.
    if (!(error instanceof DatabaseNotConfiguredError)) console.error("Earnings: couldn't read the payouts.", error);
  }
  return <Earnings view={data?.view ?? null} payrollDetails={data?.payrollDetails} payroll={query.payroll} />;
}
