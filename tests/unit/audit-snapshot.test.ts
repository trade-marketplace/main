import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { encryptField } from "@/server/crypto";
import { REDACTED, auditChanges, isSecretField } from "@/server/audit/snapshot";

// What the audit log keeps of a record (#100): only what changed, as JSON, never a secret.

const env = { FIELD_ENCRYPTION_KEY: randomBytes(32).toString("base64") };

describe("auditChanges", () => {
  it("keeps only the fields that changed, before and after", () => {
    const before = { id: "p1", status: "PAID", refundedCents: 0, updatedAt: new Date("2026-10-01T00:00:00Z") };
    const after = { id: "p1", status: "REFUNDED", refundedCents: 5000, updatedAt: new Date("2026-10-02T00:00:00Z") };
    expect(auditChanges(before, after)).toEqual({
      before: { status: "PAID", refundedCents: 0, updatedAt: "2026-10-01T00:00:00.000Z" },
      after: { status: "REFUNDED", refundedCents: 5000, updatedAt: "2026-10-02T00:00:00.000Z" },
    });
  });

  it("keeps the whole record for a create (no before) and a delete (no after)", () => {
    const row = { id: "v1", minutes: 90, note: null };
    expect(auditChanges(null, row)).toEqual({ before: null, after: { id: "v1", minutes: 90, note: null } });
    expect(auditChanges(row, null)).toEqual({ before: { id: "v1", minutes: 90, note: null }, after: null });
  });

  it("gives empty halves when nothing changed", () => {
    expect(auditChanges({ a: 1, b: { x: 1, y: 2 } }, { a: 1, b: { y: 2, x: 1 } })).toEqual({ before: {}, after: {} });
  });

  it("counts a field only one side has as changed, shown as null on the other", () => {
    expect(auditChanges({ a: 1 }, { a: 1, b: "new" })).toEqual({ before: { b: null }, after: { b: "new" } });
    expect(auditChanges({ a: 1, b: "old" }, { a: 1 })).toEqual({ before: { b: "old" }, after: { b: null } });
  });

  it("treats a missing field and an undefined one alike, so a partial `after` isn't a change", () => {
    expect(auditChanges({ a: 1, b: undefined }, { a: 2 })).toEqual({ before: { a: 1 }, after: { a: 2 } });
  });

  it("keeps a changed JSON column whole", () => {
    expect(auditChanges({ rates: { a: 1, b: 2 } }, { rates: { a: 1, b: 3 } })).toEqual({
      before: { rates: { a: 1, b: 2 } },
      after: { rates: { a: 1, b: 3 } },
    });
  });

  it("writes bigints, decimals, odd numbers and binary as plain JSON", () => {
    const decimal = { toJSON: () => "12.50" };
    expect(auditChanges(null, { big: 12n, amount: decimal, ratio: Number.NaN, file: Buffer.from("x") })).toEqual({
      before: null,
      after: { big: "12", amount: "12.50", ratio: "NaN", file: "[binary]" },
    });
  });

  it("refuses a snapshot that isn't an object of fields", () => {
    expect(() => auditChanges(null, ["a"] as unknown as Record<string, unknown>)).toThrow(TypeError);
  });

  describe("secrets", () => {
    it("never writes an encrypted IRD number or bank account, but shows they changed", () => {
      const before = {
        irdNumberEncrypted: encryptField("123456789", "ctx", env),
        irdNumberLast3: "789",
        bankAccountEncrypted: null,
        bankAccountLast4: null,
      };
      const after = {
        irdNumberEncrypted: encryptField("987654321", "ctx", env),
        irdNumberLast3: "321",
        bankAccountEncrypted: encryptField("12-3456-7890123-00", "ctx", env),
        bankAccountLast4: "2300",
      };
      expect(auditChanges(before, after)).toEqual({
        before: { irdNumberEncrypted: REDACTED, irdNumberLast3: "789", bankAccountEncrypted: null, bankAccountLast4: null },
        after: { irdNumberEncrypted: REDACTED, irdNumberLast3: "321", bankAccountEncrypted: REDACTED, bankAccountLast4: "2300" },
      });
    });

    it("redacts every secret in a create or delete too", () => {
      const row = { userId: "u", bankAccountEncrypted: encryptField("12-3456-7890123-00", "ctx", env), taxCode: "M" };
      expect(auditChanges(null, row).after).toEqual({ userId: "u", bankAccountEncrypted: REDACTED, taxCode: "M" });
      expect(auditChanges(row, null).before).toEqual({ userId: "u", bankAccountEncrypted: REDACTED, taxCode: "M" });
    });

    it("redacts a plain IRD number or bank account a caller passed by mistake", () => {
      expect(auditChanges(null, { irdNumber: "123-456-789", bank_account: "12-3456-7890123-00" }).after).toEqual({
        irdNumber: REDACTED,
        bank_account: REDACTED,
      });
    });

    it("redacts secrets nested inside a JSON field", () => {
      expect(auditChanges(null, { meta: { webhookSecret: "whsec_abc", nested: [{ accessToken: "t" }] } }).after).toEqual({
        meta: { webhookSecret: REDACTED, nested: [{ accessToken: REDACTED }] },
      });
    });

    it("redacts anything shaped like an encrypted field, whatever it's called", () => {
      const sealed = encryptField("123456789", "ctx", env);
      expect(auditChanges(null, { note: sealed, list: [sealed] }).after).toEqual({ note: REDACTED, list: [REDACTED] });
    });

    it("doesn't report a secret as changed when it wasn't", () => {
      const sealed = encryptField("123456789", "ctx", env);
      expect(auditChanges({ irdNumberEncrypted: sealed, taxCode: "M" }, { irdNumberEncrypted: sealed, taxCode: "S" })).toEqual({
        before: { taxCode: "M" },
        after: { taxCode: "S" },
      });
    });

    it("names secret fields by meaning, and leaves masked digits and ordinary keys alone", () => {
      for (const name of ["irdNumberEncrypted", "bank_account_encrypted", "password", "clientSecret", "refreshToken", "apiKey"]) {
        expect(isSecretField(name), name).toBe(true);
      }
      for (const name of ["irdNumberLast3", "bankAccountLast4", "idempotencyKey", "taxCode", "status"]) {
        expect(isSecretField(name), name).toBe(false);
      }
    });
  });
});
