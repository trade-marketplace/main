import type { Metadata } from "next";
import { AccountSettings } from "@/components/account/AccountSettings";
import { PayrollLoadError, PayrollSettings } from "@/components/account/PayrollSettings";
import { privateMetadata } from "@/lib/metadata";
import { loadPayroll } from "@/server/account/payroll";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";

export const metadata: Metadata = { ...privateMetadata, title: "Bank & tax" };
export default async function PayrollPage() {
  const viewer = await requireRole(["TRADIE"], { next: "/profile/payroll" });
  let initial = null;
  try { initial = await loadPayroll(getDb(), viewer.userId); } catch { /* A retry stays on this protected route. */ }
  return <AccountSettings role="TRADIE" active="/profile/payroll">
    {initial ? <PayrollSettings initial={initial} /> : <PayrollLoadError />}
  </AccountSettings>;
}
