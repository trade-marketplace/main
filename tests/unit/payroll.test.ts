import { describe, expect, it } from "vitest";
import { bankAccountParts, normalizedBankAccount, readPayrollInput, validBankAccount, validIrdNumber, validatePayroll } from "@/lib/payroll";

const input = { bankAccount: "01-0902-0068389-00", irdNumber: "49-091-850", taxCode: "M", kiwiSaverRate: "3.5", currentPassword: "test-only-password" };
describe("IRD payroll specification 2026/27 check digits", () => {
  it.each(["49091850", "35-901-981", "100000305", "150000025"])("accepts %s including secondary-weight and nine-digit cases", value => expect(validIrdNumber(value)).toBe(true));
  it.each(["49091851", "35901980", "100000300", "00000000", "9999999", "200000001", "150000026", "49A91850", "", "1234567890"])("rejects %s", value => expect(validIrdNumber(value)).toBe(false));
  it("uses the secondary weights only when the primary check digit is ten", () => {
    expect(validIrdNumber("49091850")).toBe(true);
    expect(validIrdNumber("49091854")).toBe(false);
  });
});
describe("NZ bank algorithms", () => {
  // A and D are the IRD specification examples; B/F/X exercise the other current bank mappings.
  it.each(["01-902-0068389-00", "01-0902-0068389-000", "08-6523-1954512-001", "01-0001-0990008-00", "25-0001-0000017-00", "31-2800-1234567-00"])("accepts %s", value => {
    expect(validBankAccount(value)).toBe(true);
  });
  it.each(["01-0902-0068388-00", "08-6523-1954513-001", "25-0001-0000011-00", "99-0902-0068389-00", "01-0902-0000000-00", "01-0902-0068389", "01-0902-0068389-ABCDE", "010902006838900000", "01902006838900", ""])("rejects %s", value => expect(validBankAccount(value)).toBe(false));
  it("left-pads each component for checks and stores a familiar unambiguous format", () => {
    expect(bankAccountParts("1-902-68389-0")).toEqual(["01", "0902", "00068389", "0000"]);
    expect(normalizedBankAccount("1-902-68389-0")).toBe(input.bankAccount);
    expect(validBankAccount("010902006838900")).toBe(true);
    expect(validBankAccount("0109020068389000")).toBe(true);
  });
});
describe("shared payroll validation", () => {
  it.each(["none", "3", "3.5", "4", "6", "8", "10"])("supports the current and approved temporary rate %s", rate => expect(validatePayroll({ ...input, kiwiSaverRate: rate })).toMatchObject({ ok: true, data: { kiwiSaverRatePct: rate === "none" ? null : Number(rate) } }));
  it("never includes submitted private values in validation failures", () => {
    const result = validatePayroll({ ...input, bankAccount: "secret-bank", irdNumber: "secret-ird", taxCode: "forged", kiwiSaverRate: "5", currentPassword: "" });
    expect(result).toMatchObject({ ok: false, fields: { bankAccount: expect.any(String), irdNumber: expect.any(String), taxCode: expect.any(String), kiwiSaverRate: expect.any(String), currentPassword: expect.any(String) } });
    expect(JSON.stringify(result)).not.toMatch(/secret-bank|secret-ird/);
  });
  it("rejects oversized input rather than truncating it to something valid", () => {
    expect(readPayrollInput({ ...input, bankAccount: input.bankAccount + " ".repeat(100) }).bankAccount).toBe("");
    expect(validatePayroll(readPayrollInput({ ...input, currentPassword: "x".repeat(201) }))).toMatchObject({ ok: false });
  });
});
