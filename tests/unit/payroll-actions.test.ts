import { beforeEach, expect, it, vi } from "vitest";
const fakes = vi.hoisted(() => ({ authorize: vi.fn(), deps: vi.fn(), save: vi.fn(), db: vi.fn(), key: vi.fn(), refresh: vi.fn() }));
vi.mock("@/server/auth/guard", async original => { const real = await original<typeof import("@/server/auth/guard")>(); return { ...real, withRole: real.createGuards(async () => fakes.authorize()).withRole }; });
vi.mock("@/server/auth/security-deps", () => ({ securityDeps: fakes.deps }));
vi.mock("@/server/account/payroll", () => ({ savePayroll: fakes.save, payrollCanSave: fakes.key }));
vi.mock("@/server/db", () => ({ getDb: fakes.db }));
vi.mock("next/cache", () => ({ revalidatePath: fakes.refresh }));
const { savePayrollAction } = await import("@/server/account/payroll-actions");
beforeEach(() => { vi.clearAllMocks(); fakes.key.mockReturnValue(true); fakes.authorize.mockResolvedValue({ userId: "session-owner", role: "TRADIE" }); fakes.save.mockResolvedValue({ ok: true, summary: {} }); });
it("never echoes bank/IRD/password in an expired-session action response", async () => {
  fakes.authorize.mockResolvedValue(null);
  const result = await savePayrollAction({ bankAccount: "private-bank", irdNumber: "private-ird", currentPassword: "private-password" });
  expect(result).toMatchObject({ ok: false, error: "session-expired", values: {} });
  expect(JSON.stringify(result)).not.toContain("private-");
  expect(fakes.deps).not.toHaveBeenCalled(); expect(fakes.db).not.toHaveBeenCalled();
});
it("refuses customers/office before constructing clients", async () => {
  for (const role of ["CUSTOMER", "ADMIN", "STAFF"]) { fakes.authorize.mockResolvedValue({ userId: "wrong-role", role }); expect(await savePayrollAction({})).toEqual({ ok: false, error: "forbidden" }); }
  expect(fakes.save).not.toHaveBeenCalled();
});
it("takes identity from the server, refreshes Earnings only on success, and handles missing configuration", async () => {
  const input = { userId: "forged", bankAccount: "private-bank" }; await savePayrollAction(input);
  expect(fakes.save).toHaveBeenCalledWith(undefined, undefined, "session-owner", input);
  expect(fakes.refresh).toHaveBeenCalledWith("/earnings");
  vi.clearAllMocks(); fakes.key.mockReturnValue(false);
  expect(await savePayrollAction(input)).toEqual({ ok: false, error: "no-key" });
  expect(fakes.db).not.toHaveBeenCalled(); expect(fakes.deps).not.toHaveBeenCalled(); expect(fakes.refresh).not.toHaveBeenCalled();
});
