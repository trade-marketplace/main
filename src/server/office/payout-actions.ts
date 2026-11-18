"use server";
// The Payouts page's two writes (#166, #175). Office only: withRole checks the session's role, and the commands
// read it again inside their transactions (src/server/office/payouts.ts).
import { revalidatePath } from "next/cache";

import type { ExportPayrollResult, MarkPaidResult } from "@/lib/office/payouts";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";

import { exportPayroll, markBatchPaid } from "./payouts";

export const exportPayrollAction = withRole(["ADMIN"], async (viewer): Promise<ExportPayrollResult> => {
  try {
    const result = await exportPayroll(getDb(), viewer);
    if (result.status === "exported") { revalidatePath("/admin/payouts"); revalidatePath("/earnings"); }
    return result;
  } catch { return { status: "unavailable" }; }
});

export const markBatchPaidAction = withRole(["ADMIN"], async (viewer, batchKey: string): Promise<MarkPaidResult> => {
  try {
    const result = await markBatchPaid(getDb(), viewer, batchKey);
    if (result.status === "paid") { revalidatePath("/admin/payouts"); revalidatePath("/earnings"); }
    return result;
  } catch { return { status: "unavailable" }; }
});
