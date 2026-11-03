"use client";
import { PayrollSettings, type PayrollAction, type PayrollPreview } from "@/components/account/PayrollSettings";
import { validatePayroll, type PayrollSummary } from "@/lib/payroll";

export function PayrollDemo({ state }: { state: string }) {
  const saved = state !== "missing" && state !== "no-key";
  const initial: PayrollSummary = { bankAccountLast4: saved ? "8900" : null, irdNumberLast3: saved ? "850" : null, taxCode: saved ? "M" : null, kiwiSaverRatePct: null, saved, complete: saved, canSave: state !== "no-key" };
  const action: PayrollAction = async input => {
    const validation = validatePayroll(input);
    if (!validation.ok) return { ok: false, error: "invalid", fields: validation.fields };
    if (input.currentPassword !== "demo-current-password") return { ok: false, error: "wrong-password", fields: { currentPassword: "That’s not your current password." } };
    if (state === "error") return { ok: false, error: "unavailable" };
    return { ok: true, summary: { bankAccountLast4: validation.data.bankAccount.replace(/\D/g, "").slice(-4), irdNumberLast3: validation.data.irdNumber.slice(-3), taxCode: validation.data.taxCode, kiwiSaverRatePct: validation.data.kiwiSaverRatePct, saved: true, complete: true, canSave: true } };
  };
  return <PayrollSettings initial={initial} action={action} preview={state as PayrollPreview} />;
}
