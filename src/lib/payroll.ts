// Shared D15 validation. IRD Payroll Calculations & Business Rules 2026/27, sections 6–7:
// https://www.ird.govt.nz/digital-service-providers/services-catalogue/returns-and-information/payday-filing/payroll-calculations-and-business-rules
// Checks format/check digits, not whether a bank account exists or belongs to the worker.
export const PAYROLL_PATH = "/profile/payroll";
export const TAX_CODE_HELP = "https://www.ird.govt.nz/income-tax/income-tax-for-individuals/tax-codes-and-tax-rates-for-individuals/what-tax-code-should-i-use";
export const TAX_CODES = ["M", "ME", "M SL", "ME SL", "SB", "S", "SH", "ST", "SA", "SB SL", "S SL", "SH SL", "ST SL", "SA SL", "CAE", "EDW", "ND"] as const;
export const KIWISAVER_RATES = [3.5, 4, 6, 8, 10] as const;
export const OFFICE_TAX_CODE = "office-review";
export type PayrollReview = "kiwisaver" | "tax-code";
/** Certificates/temporary reductions need verified approval metadata; a saved election alone is not proof. */
export function payrollReviewReasons(details: { taxCode: string | null; kiwiSaverRatePct?: unknown } | null): PayrollReview[] {
  const review: PayrollReview[] = [];
  if (details?.kiwiSaverRatePct != null && Number(details.kiwiSaverRatePct) === 3) review.push("kiwisaver");
  if (details?.taxCode?.trim() && !(TAX_CODES as readonly string[]).includes(details.taxCode)) review.push("tax-code");
  return review;
}

export type PayrollInput = { bankAccount: string; irdNumber: string; taxCode: string; kiwiSaverRate: string; currentPassword: string };
export type PayrollFields = Partial<Record<keyof PayrollInput, string>>;
export type PayrollSummary = { bankAccountLast4: string | null; irdNumberLast3: string | null; taxCode: string | null; kiwiSaverRatePct: number | null; saved: boolean; complete: boolean; canSave: boolean; review: PayrollReview[] };
export type PayrollResult = { ok: true; summary: PayrollSummary } | { ok: false; error: "invalid" | "wrong-password" | "session-expired" | "forbidden" | "try-later" | "unavailable" | "no-key"; fields?: PayrollFields };

const clean = (value: string) => value.trim().replace(/[ -]/g, "");
export function validIrdNumber(value: string): boolean {
  const number = clean(value);
  if (!/^\d{8,9}$/.test(number) || Number(number) < 10_000_000 || Number(number) > 200_000_000) return false;
  const digits = number.padStart(9, "0").split("").map(Number);
  const check = (weights: number[]) => (11 - weights.reduce((sum, weight, index) => sum + weight * digits[index], 0) % 11) % 11;
  let digit = check([3, 2, 7, 6, 5, 4, 3, 2]);
  if (digit === 10) digit = check([7, 4, 3, 2, 5, 2, 7, 6]);
  return digit !== 10 && digit === digits[8];
}

const AB_BANKS = new Set(["01", "02", "03", "04", "05", "06", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "27", "30", "38", "88"]);
const BANK_WEIGHTS = {
  A: [0, 0, 6, 3, 7, 9, 0, 0, 10, 5, 8, 4, 2, 1, 0, 0, 0, 0],
  B: [0, 0, 0, 0, 0, 0, 0, 0, 10, 5, 8, 4, 2, 1, 0, 0, 0, 0],
  D: [0, 0, 0, 0, 0, 0, 0, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0],
  F: [0, 0, 0, 0, 0, 0, 0, 1, 7, 3, 1, 7, 3, 1, 0, 0, 0, 0],
};

export function bankAccountParts(value: string): string[] | null {
  const formatted = /^(\d{1,2})[- ]+(\d{1,4})[- ]+(\d{1,8})[- ]+(\d{1,4})$/.exec(value.trim());
  let parts = formatted?.slice(1);
  if (!parts) {
    const digits = clean(value);
    const sizes: Record<number, number[]> = { 15: [2, 4, 7, 2], 16: [2, 4, 7, 3], 18: [2, 4, 8, 4] };
    const layout = sizes[digits.length];
    if (!/^\d+$/.test(digits) || !layout) return null;
    let offset = 0;
    parts = layout.map(size => { const part = digits.slice(offset, offset + size); offset += size; return part; });
  }
  return parts.map((part, index) => part.padStart([2, 4, 8, 4][index], "0"));
}

export function validBankAccount(value: string): boolean {
  const parts = bankAccountParts(value);
  if (!parts || Number(parts[2]) === 0) return false;
  const [bank, , base] = parts;
  // IRD explicitly defines X for bank31: valid format, no check-digit restriction.
  if (bank === "31") return true;
  const algorithm = AB_BANKS.has(bank) ? Number(base) < 990_000 ? "A" : "B" : bank === "08" ? "D" : bank === "25" ? "F" : null;
  if (!algorithm) return false;
  const sum = parts.join("").split("").reduce((total, digit, index) => total + Number(digit) * BANK_WEIGHTS[algorithm][index], 0);
  return sum % (algorithm === "F" ? 10 : 11) === 0;
}

export function normalizedBankAccount(value: string): string {
  const parts = bankAccountParts(value)!;
  return [parts[0], parts[1], parts[2].startsWith("0") ? parts[2].slice(1) : parts[2], String(Number(parts[3])).padStart(2, "0")].join("-");
}

export function validatePayroll(input: PayrollInput): { ok: true; data: { bankAccount: string; irdNumber: string; taxCode: string; kiwiSaverRatePct: number | null } } | { ok: false; fields: PayrollFields } {
  const fields: PayrollFields = {};
  if (!validBankAccount(input.bankAccount)) fields.bankAccount = "Enter a valid New Zealand bank account number.";
  if (!validIrdNumber(input.irdNumber)) fields.irdNumber = "Enter a valid IRD number.";
  if (!(TAX_CODES as readonly string[]).includes(input.taxCode)) fields.taxCode = [OFFICE_TAX_CODE, "STC", "NSW"].includes(input.taxCode) ? "Contact us to check your tax code before saving." : "Choose your tax code.";
  if (input.kiwiSaverRate !== "none" && !(KIWISAVER_RATES as readonly number[]).includes(Number(input.kiwiSaverRate))) fields.kiwiSaverRate = "Choose your KiwiSaver rate.";
  if (!input.currentPassword || input.currentPassword.length > 200) fields.currentPassword = "Enter your current password.";
  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, data: { bankAccount: normalizedBankAccount(input.bankAccount), irdNumber: clean(input.irdNumber), taxCode: input.taxCode, kiwiSaverRatePct: input.kiwiSaverRate === "none" ? null : Number(input.kiwiSaverRate) } };
}

export function readPayrollInput(input: unknown): PayrollInput {
  const row = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const text = (key: string, max: number) => typeof row[key] === "string" && row[key].length <= max ? row[key] : "";
  return { bankAccount: text("bankAccount", 80), irdNumber: text("irdNumber", 40), taxCode: text("taxCode", 20), kiwiSaverRate: text("kiwiSaverRate", 10), currentPassword: text("currentPassword", 201) };
}

export function maskedBank(last4: string | null) { return last4 ? `•••• •••• ${last4}` : "Not added"; }
export function maskedIrd(last3: string | null) { return last3 ? `••• ••• ${last3}` : "Not added"; }
