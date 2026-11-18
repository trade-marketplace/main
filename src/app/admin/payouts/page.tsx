// /admin/payouts, the office's Payouts (#175, F10): the next payroll batch, who is held back, Export payroll CSV and
// Mark batch paid (#166). The office layout already checks the role; this page checks again because it reads pay.
import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";

import { OfficePayouts } from "@/components/office/OfficePayouts";
import { privateMetadata } from "@/lib/metadata";
import { PAYOUTS_PATH, type OfficePayoutsData } from "@/lib/office/payouts";
import { requireRole } from "@/server/auth/guard";
import { DatabaseNotConfiguredError, getDb } from "@/server/db";
import { loadOfficePayouts } from "@/server/office/payouts";

export const metadata: Metadata = { ...privateMetadata, title: "Payouts" };
// Pay records: always read per request, never prerendered.
export const dynamic = "force-dynamic";

export default async function PayoutsPage() {
  const viewer = await requireRole(["ADMIN"], { next: PAYOUTS_PATH });
  let data: OfficePayoutsData | null = null;
  try {
    data = await loadOfficePayouts(getDb(), viewer);
  } catch (error) {
    unstable_rethrow(error);
    // Shown as "Can’t load payouts" with Try again; the details stay in the server log.
    if (!(error instanceof DatabaseNotConfiguredError)) console.error("Payouts: couldn't read the payouts.", error);
  }
  return <OfficePayouts data={data} />;
}
