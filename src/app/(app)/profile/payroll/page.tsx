import type { Metadata } from "next";
import { AccountSettings } from "@/components/account/AccountSettings";
import { PayrollLoadError, PayrollSettings } from "@/components/account/PayrollSettings";
import { TextLink } from "@/components/TextLink";
import { boardSettingsRoute } from "@/lib/job-board";
import { privateMetadata } from "@/lib/metadata";
import { loadPayroll } from "@/server/account/payroll";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";

export const metadata: Metadata = { ...privateMetadata, title: "Bank & tax" };
export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ next?: unknown }> }) {
  const destination = boardSettingsRoute("/profile/payroll", (await searchParams).next);
  const viewer = await requireRole(["TRADIE"], { next: destination.href });
  let initial = null;
  try { initial = await loadPayroll(getDb(), viewer.userId); } catch { /* A retry stays on this protected route. */ }
  return <AccountSettings role="TRADIE" active="/profile/payroll">
    {destination.back && <TextLink href={destination.back}>Back to jobs</TextLink>}
    {initial ? <PayrollSettings initial={initial} /> : <PayrollLoadError />}
  </AccountSettings>;
}
