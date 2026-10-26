import { describe, expect, it } from "vitest";

import {
  decryptField,
  encryptField,
  FieldDecryptionError,
  FieldEncryptionKeyError,
  lastDigits,
  parseFieldEncryptionKey,
} from "@/server/crypto";

const env = { FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64") };
const otherKey = { FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64") };
const context = "payroll_details.bank_account:5b0c6f4e-0000-4000-8000-000000000001";

describe("encryptField / decryptField", () => {
  it("gets the original value back with the same key and context", () => {
    const stored = encryptField("12-3456-7890123-00", context, env);
    expect(decryptField(stored, context, env)).toBe("12-3456-7890123-00");
  });

  it("never stores the value in the clear, and encrypts it differently every time", () => {
    const first = encryptField("123-456-789", context, env);
    const second = encryptField("123-456-789", context, env);
    expect(first).not.toContain("123");
    expect(first).not.toBe(second);
    expect(first).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it("won't decrypt a value copied onto another person's row", () => {
    const stored = encryptField("12-3456-7890123-00", context, env);
    expect(() => decryptField(stored, "payroll_details.bank_account:someone-else", env)).toThrow(FieldDecryptionError);
  });

  it("won't decrypt with a different key", () => {
    const stored = encryptField("12-3456-7890123-00", context, env);
    expect(() => decryptField(stored, context, otherKey)).toThrow(FieldDecryptionError);
  });

  it("notices a value that was changed in the database", () => {
    const [version, iv, tag, ciphertext] = encryptField("12-3456-7890123-00", context, env).split(".");
    const flipped = Buffer.from(ciphertext, "base64url");
    flipped[0] ^= 1;
    expect(() => decryptField([version, iv, tag, flipped.toString("base64url")].join("."), context, env)).toThrow(
      FieldDecryptionError,
    );
    expect(() => decryptField([version, iv, tag.slice(0, 8), ciphertext].join("."), context, env)).toThrow(FieldDecryptionError);
    expect(() => decryptField("not encrypted", context, env)).toThrow(FieldDecryptionError);
  });

  it("explains how to set the key when it's missing", () => {
    expect(() => encryptField("123-456-789", context, {})).toThrow(FieldEncryptionKeyError);
    expect(() => encryptField("123-456-789", context, {})).toThrow(/FIELD_ENCRYPTION_KEY is not set[\s\S]*\.env\.example/);
  });
});

describe("parseFieldEncryptionKey", () => {
  it("accepts 32 base64-encoded bytes", () => {
    expect(parseFieldEncryptionKey(env.FIELD_ENCRYPTION_KEY)).toHaveLength(32);
  });

  it("rejects a key that's too short or isn't base64", () => {
    expect(() => parseFieldEncryptionKey(Buffer.alloc(16).toString("base64"))).toThrow(/must be 32 random bytes/);
    expect(() => parseFieldEncryptionKey("correct horse battery staple")).toThrow(/must be 32 random bytes/);
  });
});

describe("lastDigits", () => {
  it("keeps only the last digits, ignoring dashes and spaces", () => {
    expect(lastDigits("12-3456-7890123-00", 4)).toBe("2300");
    expect(lastDigits("123 456 789", 3)).toBe("789");
  });

  it("refuses a value with too few digits", () => {
    expect(() => lastDigits("12", 3)).toThrow(RangeError);
  });
});
