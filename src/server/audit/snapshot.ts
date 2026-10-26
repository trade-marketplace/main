import "server-only";

// Turns a record's before and after into what the audit log keeps (#100): only the fields that changed, as plain
// JSON, with secrets replaced by REDACTED. Pure, so it's tested without a database.
//
// - Create (no before): every field of `after`. Delete (no after): every field of `before`.
// - Update: a field is in both halves when its value differs, and in neither when it doesn't. A field only one
//   side has counts as changed (the other side shows null).
// - Fields are compared as top-level columns: a JSON column that changed is kept whole.
// - Dates become ISO strings, bigints and decimals strings, binary data "[binary]"; `undefined` fields are left
//   out, as Prisma leaves them out of a write.
// - Secrets are never written: encrypted columns (IRD number, bank account: src/server/crypto.ts), anything named
//   like a password, secret, token or key, the plain IRD number or bank account if a caller passes one, and any
//   string shaped like an encrypted field whatever its name. The field still shows as changed, so the timeline can
//   say "bank account changed" without the number. The masked last digits (`bankAccountLast4`) are kept.

export const REDACTED = "[redacted]";

/** A record, or the part of it the caller has: column name → value, as Prisma returns it. */
export type AuditSnapshot = Readonly<Record<string, unknown>>;

export type AuditJson = string | number | boolean | null | AuditJson[] | { [key: string]: AuditJson };
export type AuditJsonObject = { [key: string]: AuditJson };

export type AuditChanges = { before: AuditJsonObject | null; after: AuditJsonObject | null };

// Compared with `_` and case removed, so `bank_account_encrypted` and `bankAccountEncrypted` match alike.
const SECRET_NAME = /encrypted|password|passcode|secret|token|apikey|privatekey|signingkey|^irdnumber$|^bankaccount$/;

// The stored form of encryptField: v1.<iv>.<auth tag>.<ciphertext>, each part base64url.
const ENCRYPTED_VALUE = /^v\d+\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]*$/;

export function isSecretField(name: string): boolean {
  return SECRET_NAME.test(name.replace(/[_\-\s]/g, "").toLowerCase());
}

export function auditChanges(before: AuditSnapshot | null, after: AuditSnapshot | null): AuditChanges {
  const old = before ? toJsonObject(before) : null;
  const next = after ? toJsonObject(after) : null;
  if (!old || !next) return { before: old && redactObject(old), after: next && redactObject(next) };

  const changedBefore: AuditJsonObject = {};
  const changedAfter: AuditJsonObject = {};
  for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
    const was = old[key] ?? null;
    const now = next[key] ?? null;
    if (sameJson(was, now)) continue;
    changedBefore[key] = redactField(key, was);
    changedAfter[key] = redactField(key, now);
  }
  return { before: changedBefore, after: changedAfter };
}

function toJsonObject(snapshot: AuditSnapshot): AuditJsonObject {
  const json = toJson(snapshot);
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    throw new TypeError("An audit snapshot must be an object of fields.");
  }
  return json;
}

function toJson(value: unknown): AuditJson | undefined {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof Uint8Array) return "[binary]";
  if (Array.isArray(value)) return value.map((item) => toJson(item) ?? null);
  // Prisma's Decimal (and anything else that says how to be JSON).
  if (typeof (value as { toJSON?: unknown }).toJSON === "function") return toJson((value as { toJSON(): unknown }).toJSON());
  const object: AuditJsonObject = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const json = toJson(item);
    if (json !== undefined) object[key] = json;
  }
  return object;
}

function redactField(key: string, value: AuditJson): AuditJson {
  if (isSecretField(key)) return value === null ? null : REDACTED;
  return redactValue(value);
}

function redactValue(value: AuditJson): AuditJson {
  if (typeof value === "string") return ENCRYPTED_VALUE.test(value) ? REDACTED : value;
  if (Array.isArray(value)) return value.map(redactValue);
  if (value !== null && typeof value === "object") return redactObject(value);
  return value;
}

function redactObject(object: AuditJsonObject): AuditJsonObject {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, redactField(key, value)]));
}

function sameJson(a: AuditJson, b: AuditJson): boolean {
  return canonical(a) === canonical(b);
}

/** JSON with object keys sorted, so `{a, b}` and `{b, a}` compare equal. */
function canonical(value: AuditJson): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
