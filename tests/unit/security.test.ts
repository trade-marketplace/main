import { describe, expect, it, vi } from "vitest";

import { readSecurityForm, validateSecurity, type SecurityInput } from "@/lib/auth/security";
import { changeSecurity, readSecurityUser, type SecurityDeps, type SecurityUser } from "@/server/auth/security";
import { confirmSecurityEmail } from "@/server/auth/security-confirm";

const user = { id: "customer-1", email: "sarah@example.test", email_confirmed_at: "2026-01-01T00:00:00Z" };
const success = () => ({ data: { user }, error: null });
const input: SecurityInput = { operation: "password", currentPassword: "old secure password", password: "a new secure password", confirmPassword: "a new secure password", email: "new@example.test" };
const callback = "https://preview.example.test/profile/security/confirm";
function setup() {
  return {
    auth: { getUser: vi.fn(async () => success()), updateUser: vi.fn(async () => success()), signOut: vi.fn(async () => ({ error: null })) },
    verifyPassword: vi.fn(async () => success()),
    syncEmail: vi.fn<(user: SecurityUser) => Promise<void>>(async () => {}),
  };
}

describe("security validation", () => {
  it("does not trim passwords or read an identity from the form", () => {
    const form = new FormData();
    form.set("currentPassword", " spaces stay "); form.set("userId", "attacker"); form.set("email", new Blob(["not a string"]));
    expect(readSecurityForm("sessions", form)).toEqual({ operation: "sessions", currentPassword: " spaces stay ", email: "", password: "", confirmPassword: "" });
  });
  it.each([
    [{ currentPassword: "" }, "currentPassword"],
    [{ password: "short" }, "password"],
    [{ password: "password123456" }, "password"],
    [{ password: "😀".repeat(25) }, "password"],
    [{ password: input.currentPassword, confirmPassword: input.currentPassword }, "password"],
    [{ confirmPassword: "different" }, "confirmPassword"],
    [{ operation: "email", email: "bad@" }, "email"],
    [{ operation: "email", email: " SARAH@example.test " }, "email"],
  ])("rejects %j", (changes, field) => {
    expect(validateSecurity({ ...input, ...changes } as SecurityInput, user.email)).toMatchObject({ ok: false, error: "invalid", fields: { [field]: expect.any(String) } });
  });
});

describe("security changes with no real provider or database", () => {
  it("changes the password, then ends other sessions, preserving this one", async () => {
    const deps = setup();
    expect(await changeSecurity(deps, user.id, input, callback)).toEqual({ ok: true, status: "password-changed" });
    expect(deps.verifyPassword).toHaveBeenCalledWith(user.email, input.currentPassword);
    expect(deps.auth.updateUser).toHaveBeenCalledWith({ password: input.password, current_password: input.currentPassword }, undefined);
    expect(deps.auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "others" });
    expect(deps.auth.updateUser.mock.invocationCallOrder[0]).toBeLessThan(deps.auth.signOut.mock.invocationCallOrder[0]);
  });
  it("logs out other devices without changing credentials", async () => {
    const deps = setup();
    expect(await changeSecurity(deps, user.id, { ...input, operation: "sessions" }, callback)).toEqual({ ok: true, status: "sessions-ended" });
    expect(deps.auth.updateUser).not.toHaveBeenCalled();
    expect(deps.auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "others" });
  });
  it("requests email confirmation and keeps the old email until Auth confirms it", async () => {
    const deps = setup();
    expect(await changeSecurity(deps, user.id, { ...input, operation: "email", email: " NEW@example.test " }, callback)).toEqual({ ok: true, status: "email-sent", email: "new@example.test" });
    expect(deps.auth.updateUser).toHaveBeenCalledWith({ email: "new@example.test" }, { emailRedirectTo: callback });
    expect(deps.syncEmail.mock.calls.every(([value]) => value.email === user.email)).toBe(true);
    expect(deps.auth.signOut).not.toHaveBeenCalled();
  });
  it("synchronizes an email Auth has actually changed", async () => {
    const deps = setup();
    const confirmed = { ...user, email: input.email };
    deps.auth.updateUser.mockResolvedValue({ data: { user: confirmed }, error: null });
    expect(await changeSecurity(deps, user.id, { ...input, operation: "email" }, callback)).toEqual({ ok: true, status: "email-changed", email: input.email });
    expect(deps.syncEmail).toHaveBeenLastCalledWith(confirmed);
  });
  it("an invalid form never checks a password or changes an account", async () => {
    const deps = setup();
    expect(await changeSecurity(deps, user.id, { ...input, confirmPassword: "bad" }, callback)).toMatchObject({ error: "invalid" });
    expect(deps.verifyPassword).not.toHaveBeenCalled(); expect(deps.auth.updateUser).not.toHaveBeenCalled();
  });
  it.each(["email", "password", "sessions"] as const)("wrong current password prevents %s and is never returned", async operation => {
    const deps: SecurityDeps = setup();
    deps.verifyPassword = vi.fn(async () => ({ data: { user: null }, error: { code: "invalid_credentials" } }));
    const result = await changeSecurity(deps, user.id, { ...input, operation }, callback);
    expect(result).toMatchObject({ error: "wrong-password", fields: { currentPassword: expect.any(String) } });
    expect(JSON.stringify(result)).not.toContain(input.currentPassword);
    expect(deps.auth.updateUser).not.toHaveBeenCalled(); expect(deps.auth.signOut).not.toHaveBeenCalled();
  });
  it.each([null, { ...user, id: "someone-else" }])("a missing or mismatched session cannot change an account", async authUser => {
    const deps: SecurityDeps = setup();
    deps.auth.getUser = vi.fn(async () => ({ data: { user: authUser }, error: null }));
    expect(await changeSecurity(deps, user.id, input, callback)).toMatchObject({ error: "session-expired" });
    expect(deps.verifyPassword).not.toHaveBeenCalled(); expect(deps.syncEmail).not.toHaveBeenCalled();
  });
  it("password proof for a different user cannot change the current account", async () => {
    const deps = setup();
    deps.verifyPassword.mockResolvedValue({ data: { user: { ...user, id: "another-user" } }, error: null });
    expect(await changeSecurity(deps, user.id, input, callback)).toMatchObject({ error: "session-expired" });
    expect(deps.auth.updateUser).not.toHaveBeenCalled();
  });
  it.each([
    ["over_request_rate_limit", 429, "try-later"], ["email_exists", 400, "email-taken"],
    ["weak_password", 400, "invalid"], ["same_password", 400, "invalid"],
    ["reauthentication_needed", 400, "reauthenticate"], ["invalid_current_password", 400, "wrong-password"],
    ["session_not_found", 401, "session-expired"], ["unexpected_failure", 500, "unavailable"],
  ])("handles provider error %s without claiming success", async (code, status, error) => {
    const deps: SecurityDeps = setup();
    deps.auth.updateUser = vi.fn(async () => ({ data: { user: null }, error: { code, status, message: "private provider detail" } }));
    const result = await changeSecurity(deps, user.id, input, callback);
    expect(result).toMatchObject({ ok: false, error });
    expect(JSON.stringify(result)).not.toContain("private provider detail"); expect(deps.auth.signOut).not.toHaveBeenCalled();
  });
  it.each([false, true])("a revocation failure after a password change is reported accurately (throws: %s)", async throws => {
    const deps: SecurityDeps = setup();
    deps.auth.signOut = vi.fn(async () => { if (throws) throw new Error("offline"); return { error: { status: 500 } }; });
    expect(await changeSecurity(deps, user.id, input, callback)).toEqual({ ok: false, error: "sessions-failed" });
  });
  it("an unavailable provider returns a retryable error", async () => {
    const deps = setup(); deps.auth.getUser.mockRejectedValue(new Error("offline"));
    expect(await changeSecurity(deps, user.id, input, callback)).toEqual({ ok: false, error: "unavailable" });
  });
  it("reads the email from Auth, rather than stale profile or browser data", async () => {
    const deps = setup();
    expect(await readSecurityUser(deps, user.id)).toEqual(user);
    expect(deps.syncEmail).toHaveBeenCalledWith(user);
  });
});

describe("email confirmation", () => {
  function deps() { return { exchange: vi.fn(async () => success()), syncEmail: vi.fn(async () => {}), discard: vi.fn(async () => {}) }; }
  it("checks the callback identity before synchronizing confirmed Auth data", async () => {
    const d = deps(); expect(await confirmSecurityEmail(d, user.id, "one-time-code")).toBe(true);
    expect(d.exchange).toHaveBeenCalledWith("one-time-code"); expect(d.syncEmail).toHaveBeenCalledWith(user);
  });
  it("a missing code never calls Auth", async () => {
    const d = deps(); expect(await confirmSecurityEmail(d, user.id, null)).toBe(false); expect(d.exchange).not.toHaveBeenCalled();
  });
  it("expired, invalid or reused links never change the profile", async () => {
    const d = { ...deps(), exchange: vi.fn(async () => ({ data: { user: null }, error: { code: "flow_state_not_found" } })) };
    expect(await confirmSecurityEmail(d, user.id, "used-code")).toBe(false); expect(d.syncEmail).not.toHaveBeenCalled();
  });
  it("a link for a different account discards that session and never changes either profile", async () => {
    const d = deps(); expect(await confirmSecurityEmail(d, "another-user", "code")).toBe(false);
    expect(d.discard).toHaveBeenCalledOnce(); expect(d.syncEmail).not.toHaveBeenCalled();
  });
  it("a profile write failure is retryable by revisiting Security", async () => {
    const d = deps(); d.syncEmail.mockRejectedValue(new Error("unavailable"));
    expect(await confirmSecurityEmail(d, user.id, "code")).toBe(false);
  });
});
