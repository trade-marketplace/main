"use server";

import { revalidatePath } from "next/cache";
import { withRole } from "@/server/auth/guard";
import { securityDeps } from "@/server/auth/security-deps";
import { getDb } from "@/server/db";
import { payrollCanSave, savePayroll } from "./payroll";

// Typed-object input deliberately avoids FormData: the shared session-expired response must never echo bank/IRD fields.
export const savePayrollAction = withRole(["TRADIE"], async (viewer, input: unknown) => {
  if (!payrollCanSave()) return { ok: false, error: "no-key" } as const;
  try {
    const result = await savePayroll(getDb(), await securityDeps(), viewer.userId, input);
    if (result.ok) { revalidatePath("/profile/payroll"); revalidatePath("/earnings"); }
    return result;
  } catch { return { ok: false, error: "unavailable" } as const; }
});
