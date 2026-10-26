import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Encrypts single sensitive fields (IRD number, bank account) before they're saved, so a database dump or
// backup alone never reveals them. AES-256-GCM with a key from FIELD_ENCRYPTION_KEY (see .env.example).
//
// Stored form: `v1.<iv>.<auth tag>.<ciphertext>`, each part base64url. `v1` names this format and key; a key
// change later adds `v2` and re-encrypts. Every value is bound to a context (which column of which row), so a
// ciphertext copied onto another person's row won't decrypt.

const VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;

export class FieldEncryptionKeyError extends Error {
  constructor(problem: string) {
    super(
      `FIELD_ENCRYPTION_KEY ${problem}. Generate one with ` +
        "`node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"` " +
        "and put it in .env.local (see .env.example). Keep the same key: data saved with it can't be read without it.",
    );
    this.name = "FieldEncryptionKeyError";
  }
}

export class FieldDecryptionError extends Error {
  constructor() {
    super("An encrypted field couldn't be read: it was changed, belongs to another record, or the key is wrong.");
    this.name = "FieldDecryptionError";
  }
}

/** Reads and checks the key. Exported for the env check; most code calls encryptField/decryptField. */
export function parseFieldEncryptionKey(raw: string | undefined): Buffer {
  const value = raw?.trim();
  if (!value) throw new FieldEncryptionKeyError("is not set");
  const key = Buffer.from(value, "base64");
  if (key.length !== KEY_BYTES || key.toString("base64") !== value) {
    throw new FieldEncryptionKeyError(`must be ${KEY_BYTES} random bytes, base64-encoded`);
  }
  return key;
}

/**
 * Encrypts `plaintext` for the column and row named by `context`, e.g. `payroll_details.bank_account:<userId>`.
 * The same plaintext encrypts differently every time.
 */
export function encryptField(
  plaintext: string,
  context: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const key = parseFieldEncryptionKey(env.FIELD_ENCRYPTION_KEY);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const parts = [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url"));
  return [VERSION, ...parts].join(".");
}

/** Decrypts a value made by encryptField with the same context. Throws FieldDecryptionError if it can't. */
export function decryptField(
  stored: string,
  context: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const key = parseFieldEncryptionKey(env.FIELD_ENCRYPTION_KEY);
  const [version, iv, tag, ciphertext, ...rest] = stored.split(".");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined || rest.length > 0) {
    throw new FieldDecryptionError();
  }
  try {
    // A fixed tag length, so a shortened (easier to forge) tag is rejected.
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"), { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new FieldDecryptionError();
  }
}

/** The last `count` digits of a number like an IRD number or bank account, for showing it masked. */
export function lastDigits(value: string, count: number): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < count) throw new RangeError(`needs at least ${count} digits`);
  return digits.slice(-count);
}
