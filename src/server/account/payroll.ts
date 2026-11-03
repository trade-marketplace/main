import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { readPayrollInput, validatePayroll, type PayrollResult, type PayrollSummary } from "@/lib/payroll";
import { createAudit } from "@/server/audit/audit";
import { readSecurityUser, type SecurityDeps } from "@/server/auth/security";
import { encryptField, lastDigits, parseFieldEncryptionKey } from "@/server/crypto";
import { consumeForUser, type RateLimitDecision } from "@/server/rate-limit";

type Db = Pick<PrismaClient, "payrollDetails" | "$transaction">;
type Env = Record<string, string | undefined>;
const SELECT = { bankAccountLast4: true, irdNumberLast3: true, taxCode: true, kiwiSaverRatePct: true, bankAccountEncrypted: true, irdNumberEncrypted: true } as const;

export function payrollCanSave(env: Env = process.env): boolean {
  try { parseFieldEncryptionKey(env.FIELD_ENCRYPTION_KEY); return true; } catch { return false; }
}
function summary(row: { bankAccountLast4: string | null; irdNumberLast3: string | null; taxCode: string | null; kiwiSaverRatePct: Prisma.Decimal | number | null; bankAccountEncrypted: string | null; irdNumberEncrypted: string | null } | null, canSave: boolean): PayrollSummary {
  return { bankAccountLast4: row?.bankAccountLast4 ?? null, irdNumberLast3: row?.irdNumberLast3 ?? null, taxCode: row?.taxCode ?? null, kiwiSaverRatePct: row?.kiwiSaverRatePct == null ? null : Number(row.kiwiSaverRatePct), saved: Boolean(row?.bankAccountEncrypted || row?.irdNumberEncrypted), complete: Boolean(row?.bankAccountEncrypted && row.irdNumberEncrypted && row.taxCode), canSave };
}
export async function loadPayroll(db: Pick<Db, "payrollDetails">, userId: string, env: Env = process.env): Promise<PayrollSummary> {
  return summary(await db.payrollDetails.findUnique({ where: { userId }, select: SELECT }), payrollCanSave(env));
}

export async function savePayroll(db: Db, security: SecurityDeps, userId: string, input: unknown, options: { env?: Env; rateLimit?: () => Promise<RateLimitDecision> } = {}): Promise<PayrollResult> {
  const env = options.env ?? process.env;
  if (!payrollCanSave(env)) return { ok: false, error: "no-key" };
  const parsed = validatePayroll(readPayrollInput(input));
  if (!parsed.ok) return { ok: false, error: "invalid", fields: parsed.fields };
  try {
    const limit = await (options.rateLimit ?? (() => consumeForUser("payrollSave", userId)))();
    if (!limit.allowed) return { ok: false, error: "try-later" };
    const user = await readSecurityUser(security, userId);
    if (!user?.email) return { ok: false, error: "session-expired" };
    const proof = await security.verifyPassword(user.email, readPayrollInput(input).currentPassword);
    if (proof.error) {
      if (proof.error.status === 429) return { ok: false, error: "try-later" };
      if (["invalid_credentials", "invalid_current_password"].includes(proof.error.code ?? "")) return { ok: false, error: "wrong-password", fields: { currentPassword: "That’s not your current password." } };
      return { ok: false, error: "unavailable" };
    }
    if (proof.data.user?.id !== userId) return { ok: false, error: "session-expired" };
    return await db.$transaction(async tx => {
      const person = await tx.profile.findUnique({ where: { id: userId }, select: { role: true } });
      if (person?.role !== "TRADIE") return { ok: false, error: "forbidden" } as const;
      const data = {
        bankAccountEncrypted: encryptField(parsed.data.bankAccount, `payroll_details.bank_account:${userId}`, env),
        irdNumberEncrypted: encryptField(parsed.data.irdNumber, `payroll_details.ird_number:${userId}`, env),
        bankAccountLast4: lastDigits(parsed.data.bankAccount, 4), irdNumberLast3: lastDigits(parsed.data.irdNumber, 3),
        taxCode: parsed.data.taxCode, kiwiSaverRatePct: parsed.data.kiwiSaverRatePct,
      };
      const row = await tx.payrollDetails.upsert({ where: { userId }, create: { userId, ...data }, update: data, select: SELECT });
      // D15 records field names only: not even masked digits, tax codes or contribution rates in the audit.
      await createAudit(tx)({ userId }, "payroll_details.updated", { type: "payroll_details", id: userId }, null, { fields: ["bank_account", "ird_number", "tax_code", "kiwisaver_rate"] });
      return { ok: true, summary: summary(row, true) } as const;
    });
  } catch (error) {
    // Provider/database exceptions can contain values or credentials: never echo or log them.
    const failure = typeof error === "object" && error !== null ? error as { code?: string; status?: number } : {};
    if (["session_not_found", "session_expired", "refresh_token_not_found", "bad_jwt", "user_not_found"].includes(failure.code ?? "")) return { ok: false, error: "session-expired" };
    if (failure.status === 429) return { ok: false, error: "try-later" };
    return { ok: false, error: "unavailable" };
  }
}
