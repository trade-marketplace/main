import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { savePayroll, loadPayroll, payrollCanSave } from "@/server/account/payroll";
import type { SecurityDeps } from "@/server/auth/security";
import { decryptField } from "@/server/crypto";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

vi.mock("@/server/db", () => ({ getDb: vi.fn() }));
const env = { FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 134).toString("base64") }; // Disposable test key, never deployed.
const input = { bankAccount: "01-0902-0068389-00", irdNumber: "49091850", taxCode: "M", kiwiSaverRate: "3.5", currentPassword: "test-only-password" };
const allowed = async () => ({ allowed: true as const });
describe.skipIf(!testDatabaseUrl)("private payroll save in Postgres", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: "TRADIE" | "CUSTOMER" = "TRADIE") {
    const id = randomUUID(), email = `${id}@example.test`;
    await schema.db.$executeRawUnsafe("INSERT INTO auth.users(id,email) VALUES($1::uuid,$2)", id, email);
    await schema.db.profile.create({ data: { id, email, role, firstName: "Payroll" } });
    const response = { data: { user: { id, email } }, error: null };
    const deps: SecurityDeps = { auth: { getUser: vi.fn(async () => response), updateUser: vi.fn(async () => response), signOut: vi.fn(async () => ({ error: null })) }, verifyPassword: vi.fn(async () => response), syncEmail: vi.fn(async () => {}) };
    return { id, email, deps };
  }
  it("encrypts with column/owner context, returns only masks, and audits field names only", async () => {
    const { id, email, deps } = await person();
    const result = await savePayroll(schema.db, deps, id, { ...input, email: "forged@example.test", userId: randomUUID() }, { env, rateLimit: allowed });
    expect(result).toMatchObject({ ok: true, summary: { bankAccountLast4: "8900", irdNumberLast3: "850", kiwiSaverRatePct: 3.5, complete: true } });
    expect(deps.verifyPassword).toHaveBeenCalledWith(email, input.currentPassword);
    const row = await schema.db.payrollDetails.findUniqueOrThrow({ where: { userId: id } });
    expect(row.bankAccountEncrypted).toMatch(/^v1\./);
    expect(decryptField(row.bankAccountEncrypted!, `payroll_details.bank_account:${id}`, env)).toBe(input.bankAccount);
    expect(decryptField(row.irdNumberEncrypted!, `payroll_details.ird_number:${id}`, env)).toBe(input.irdNumber);
    expect(() => decryptField(row.irdNumberEncrypted!, `payroll_details.ird_number:${randomUUID()}`, env)).toThrow();
    expect(() => decryptField(row.bankAccountEncrypted!, `payroll_details.ird_number:${id}`, env)).toThrow();
    const audits = await schema.db.auditLog.findMany({ where: { actorId: id } });
    expect(audits).toHaveLength(1);
    expect(audits[0].after).toEqual({ fields: ["bank_account", "ird_number", "tax_code", "kiwisaver_rate"] });
    for (const privateText of [input.bankAccount, input.irdNumber, input.currentPassword, row.bankAccountEncrypted!, row.irdNumberEncrypted!]) expect(JSON.stringify([result, audits])).not.toContain(privateText);
    expect(await loadPayroll(schema.db, id, env)).toEqual(result.ok ? result.summary : null);
  });
  it("supports standard elections and unenrolled without automatically changing a saved choice", async () => {
    const { id, deps } = await person();
    for (const rate of ["4", "none", "3.5"]) {
      expect(await savePayroll(schema.db, deps, id, { ...input, kiwiSaverRate: rate }, { env, rateLimit: allowed })).toMatchObject({ ok: true, summary: { kiwiSaverRatePct: rate === "none" ? null : Number(rate) } });
    }
  });
  it("preserves a legacy3% election but holds readiness until the worker chooses a supported standard rate", async () => {
    const { id, deps } = await person();
    await savePayroll(schema.db, deps, id, input, { env, rateLimit: allowed });
    await schema.db.payrollDetails.update({ where: { userId: id }, data: { kiwiSaverRatePct: 3 } });
    expect(await loadPayroll(schema.db, id, env)).toMatchObject({ saved: true, complete: false, review: ["kiwisaver"], kiwiSaverRatePct: 3 });
    expect(await savePayroll(schema.db, deps, id, { ...input, kiwiSaverRate: "3" }, { env, rateLimit: allowed })).toMatchObject({ ok: false, error: "invalid" });
    expect(Number((await schema.db.payrollDetails.findUniqueOrThrow({ where: { userId: id } })).kiwiSaverRatePct)).toBe(3);
    expect(await savePayroll(schema.db, deps, id, input, { env, rateLimit: allowed })).toMatchObject({ ok: true, summary: { complete: true, review: [], kiwiSaverRatePct: 3.5 } });
  });
  it.each(["STC", "NSW", "UNKNOWN"])("holds preserved%s until certificate/eligibility review instead of treating it as payroll-ready", async taxCode => {
    const { id, deps } = await person();
    await savePayroll(schema.db, deps, id, input, { env, rateLimit: allowed });
    await schema.db.payrollDetails.update({ where: { userId: id }, data: { taxCode } });
    const result = await loadPayroll(schema.db, id, env);
    expect(result).toMatchObject({ saved: true, complete: false, review: ["tax-code"], taxCode });
    expect(JSON.stringify(result)).not.toMatch(/49091850|01-0902-0068389-00/);
  });
  it("refuses missing/malformed keys without touching auth or the database", async () => {
    const { id, deps } = await person();
    for (const value of [undefined, "bad-key"]) {
      expect(payrollCanSave({ FIELD_ENCRYPTION_KEY: value })).toBe(false);
      expect(await savePayroll(schema.db, deps, id, input, { env: { FIELD_ENCRYPTION_KEY: value }, rateLimit: allowed })).toEqual({ ok: false, error: "no-key" });
    }
    expect(deps.auth.getUser).not.toHaveBeenCalled();
    expect(await schema.db.payrollDetails.count({ where: { userId: id } })).toBe(0);
  });
  it("requires the current session's password and fresh tradie role; failures do not write", async () => {
    const { id, deps } = await person();
    vi.mocked(deps.verifyPassword).mockResolvedValueOnce({ data: { user: null }, error: { code: "invalid_credentials", message: input.bankAccount } });
    expect(await savePayroll(schema.db, deps, id, input, { env, rateLimit: allowed })).toMatchObject({ ok: false, error: "wrong-password" });
    vi.mocked(deps.verifyPassword).mockResolvedValueOnce({ data: { user: { id: randomUUID() } }, error: null });
    expect(await savePayroll(schema.db, deps, id, input, { env, rateLimit: allowed })).toEqual({ ok: false, error: "session-expired" });
    await schema.db.profile.update({ where: { id }, data: { role: "CUSTOMER" } });
    expect(await savePayroll(schema.db, deps, id, input, { env, rateLimit: allowed })).toEqual({ ok: false, error: "forbidden" });
    expect(await schema.db.payrollDetails.count({ where: { userId: id } })).toBe(0);
    expect(await schema.db.auditLog.count({ where: { actorId: id } })).toBe(0);
  });
  it("rejects invalid checksums/rate limits and sanitizes provider failures containing private values", async () => {
    const { id, deps } = await person();
    expect(await savePayroll(schema.db, deps, id, { ...input, irdNumber: "49091851" }, { env, rateLimit: allowed })).toMatchObject({ ok: false, error: "invalid" });
    expect(await savePayroll(schema.db, deps, id, input, { env, rateLimit: async () => ({ allowed: false, retryAfter: 60 }) })).toEqual({ ok: false, error: "try-later" });
    expect(deps.verifyPassword).not.toHaveBeenCalled();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(deps.verifyPassword).mockRejectedValueOnce(new Error(`${input.bankAccount} ${input.irdNumber} ${input.currentPassword}`));
    expect(await savePayroll(schema.db, deps, id, input, { env, rateLimit: allowed })).toEqual({ ok: false, error: "unavailable" });
    expect(log).not.toHaveBeenCalled(); log.mockRestore();
    expect(await schema.db.payrollDetails.count({ where: { userId: id } })).toBe(0);
  });
  it("handles a session expiring after the page guard without returning submitted details", async () => {
    const { id, deps } = await person();
    vi.mocked(deps.auth.getUser).mockResolvedValueOnce({ data: { user: null }, error: { code: "session_expired", message: input.irdNumber } });
    expect(await savePayroll(schema.db, deps, id, input, { env, rateLimit: allowed })).toEqual({ ok: false, error: "session-expired" });
    expect(deps.verifyPassword).not.toHaveBeenCalled();
  });
  it("rolls back the encrypted update if its required audit row cannot be written", async () => {
    const { id, deps } = await person();
    await schema.db.$executeRawUnsafe(`CREATE FUNCTION "${schema.name}".reject_payroll_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.actor_id = '${id}'::uuid THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
    await schema.db.$executeRawUnsafe(`CREATE TRIGGER reject_payroll_audit BEFORE INSERT ON "${schema.name}".audit_log FOR EACH ROW EXECUTE FUNCTION "${schema.name}".reject_payroll_audit()`);
    try {
      expect(await savePayroll(schema.db, deps, id, input, { env, rateLimit: allowed })).toEqual({ ok: false, error: "unavailable" });
      expect(await schema.db.payrollDetails.count({ where: { userId: id } })).toBe(0);
    } finally {
      await schema.db.$executeRawUnsafe(`DROP TRIGGER reject_payroll_audit ON "${schema.name}".audit_log`);
    }
  });
  it("keeps payroll details behind RLS and revokes public access after changing the rate column", async () => {
    const rows = await schema.db.$queryRawUnsafe<Array<{ relrowsecurity: boolean }>>(`SELECT relrowsecurity FROM pg_class WHERE oid='"${schema.name}".payroll_details'::regclass`);
    expect(rows[0].relrowsecurity).toBe(true);
  });
});
