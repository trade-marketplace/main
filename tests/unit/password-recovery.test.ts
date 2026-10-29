import { beforeEach, describe, expect, it, vi } from "vitest";

import { recoveryLoginPath, recoveryNext, recoveryPasswordErrors, recoveryPath, recoverySeconds } from "@/lib/auth/recovery";
import { confirmRecovery, finishRecovery, saveRecoveryPassword, sendRecovery, type RecoveryAuth } from "@/server/auth/password-recovery";
import { recoveryEmailUrl } from "@/server/auth/recovery";

const auth = {
  resetPasswordForEmail: vi.fn<RecoveryAuth["resetPasswordForEmail"]>(),
  verifyOtp: vi.fn<RecoveryAuth["verifyOtp"]>(),
  getUser: vi.fn<RecoveryAuth["getUser"]>(),
  updateUser: vi.fn<RecoveryAuth["updateUser"]>(),
  getSession: vi.fn<RecoveryAuth["getSession"]>(),
  admin: { signOut: vi.fn<RecoveryAuth["admin"]["signOut"]>() },
};
const user = { id: "user-1", email: "sarah@example.test" };
const password = "korimako-gumboot-41";

beforeEach(() => {
  vi.resetAllMocks();
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  auth.verifyOtp.mockResolvedValue({ data: { user }, error: null });
  auth.getUser.mockResolvedValue({ data: { user }, error: null });
  auth.updateUser.mockResolvedValue({ error: null });
  auth.getSession.mockResolvedValue({ data: { session: { access_token: "proof-access-token" } }, error: null });
  auth.admin.signOut.mockResolvedValue({ error: null });
});

describe("recovery requests", () => {
  it("normalizes the email and supplies a reset callback with a 60-second cooldown", async () => {
    expect(await sendRecovery(auth, " SARAH@example.test ", "https://site.test/recovery/confirm", 1000)).toEqual({ ok: true, email: user.email, retryAt: 61_000 });
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(user.email, { redirectTo: "https://site.test/recovery/confirm" });
  });

  it("does not reveal whether an account exists", async () => {
    const exists = await sendRecovery(auth, user.email, "/callback", 0);
    auth.resetPasswordForEmail.mockResolvedValue({ error: { code: "user_not_found" } });
    expect(await sendRecovery(auth, user.email, "/callback", 0)).toEqual(exists);
  });

  it.each(["", "bad-email", "a".repeat(255) + "@example.test"])("rejects malformed input %s before contacting Auth", async (email) => {
    expect(await sendRecovery(auth, email, "/callback")).toEqual({ ok: false, error: "invalid-email" });
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("handles throttling and delivery outages without provider details", async () => {
    auth.resetPasswordForEmail.mockResolvedValueOnce({ error: { status: 429 } });
    expect(await sendRecovery(auth, user.email, "/callback", 0)).toEqual({ ok: false, error: "try-later", retryAt: 60_000 });
    auth.resetPasswordForEmail.mockResolvedValueOnce({ error: { status: 500, code: "unexpected_failure" } });
    expect(await sendRecovery(auth, user.email, "/callback")).toEqual({ ok: false, error: "unavailable" });
    auth.resetPasswordForEmail.mockRejectedValueOnce(new Error("private provider detail"));
    expect(await sendRecovery(auth, user.email, "/callback")).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("recovery proof", () => {
  it("accepts only a server-validated recovery token", async () => {
    expect(await confirmRecovery(auth, "proof", "recovery")).toBe("reset");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "proof", type: "recovery" });
  });

  it("does not accept missing, oversized or unrelated tokens", async () => {
    for (const [token, type] of [[null, "recovery"], ["", "recovery"], ["proof", "email"], ["proof", null], ["a".repeat(2049), "recovery"]]) {
      expect(await confirmRecovery(auth, token, type)).toBe("invalid");
    }
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("rejects reused and expired links, never establishing another reset session", async () => {
    auth.verifyOtp.mockResolvedValueOnce({ data: { user }, error: null }).mockResolvedValue({ data: { user: null }, error: { code: "otp_expired" } });
    expect(await confirmRecovery(auth, "one-time", "recovery")).toBe("reset");
    expect(await confirmRecovery(auth, "one-time", "recovery")).toBe("expired");
    expect(await confirmRecovery(auth, "old", "recovery")).toBe("expired");
  });

  it("distinguishes unavailable Auth from invalid proof", async () => {
    auth.verifyOtp.mockResolvedValueOnce({ data: { user: null }, error: { status: 503 } });
    expect(await confirmRecovery(auth, "proof", "recovery")).toBe("unavailable");
    auth.verifyOtp.mockResolvedValueOnce({ data: { user: null }, error: { code: "bad_jwt" } });
    expect(await confirmRecovery(auth, "bad", "recovery")).toBe("invalid");
    auth.verifyOtp.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect(await confirmRecovery(auth, "bad", "recovery")).toBe("invalid");
    auth.verifyOtp.mockRejectedValueOnce(new Error("private provider detail"));
    expect(await confirmRecovery(auth, "proof", "recovery")).toBe("unavailable");
  });
});

describe("password update and revocation", () => {
  it("checks the current server session and saves the password without modifying email verification", async () => {
    expect(await saveRecoveryPassword(auth, password, password)).toEqual({ ok: true });
    expect(auth.getUser).toHaveBeenCalledOnce();
    expect(auth.updateUser).toHaveBeenCalledWith({ password });
    expect(auth.admin.signOut).not.toHaveBeenCalled();
    expect(await finishRecovery(auth)).toEqual({ ok: true });
    expect(auth.admin.signOut).toHaveBeenCalledWith("proof-access-token", "global");
  });

  it("rejects a signed-out or revoked session even with a valid-looking cookie", async () => {
    auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { code: "session_not_found", status: 403 } }).mockResolvedValueOnce({ data: { user: null }, error: null });
    expect(await saveRecoveryPassword(auth, password, password)).toEqual({ ok: false, error: "invalid" });
    expect(await saveRecoveryPassword(auth, password, password)).toEqual({ ok: false, error: "invalid" });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it.each([
    ["short", "short", "password"],
    ["password123", "password123", "password"],
    ["sarah@example.test", "sarah@example.test", "password"],
    ["😀".repeat(20), "😀".repeat(20), "password"],
    [password, "different-password-42", "confirmation"],
  ])("enforces the existing password policy and match on the server", async (value, confirmation, error) => {
    expect(await saveRecoveryPassword(auth, value, confirmation)).toMatchObject({ ok: false, error });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: "weak_password" }, "password"],
    [{ code: "same_password" }, "password"],
    [{ status: 429 }, "try-later"],
    [{ status: 403, code: "session_not_found" }, "invalid"],
    [{ status: 500 }, "unavailable"],
  ])("maps provider update failures to safe actionable errors", async (providerError, error) => {
    auth.updateUser.mockResolvedValue({ error: providerError });
    expect(await saveRecoveryPassword(auth, password, password)).toMatchObject({ ok: false, error });
  });

  it("does not claim a reset finished when global revocation failed", async () => {
    auth.admin.signOut.mockResolvedValueOnce({ error: { status: 500 } }).mockRejectedValueOnce(new Error("network failure"));
    expect(await finishRecovery(auth)).toEqual({ ok: false, error: "sign-out" });
    expect(await finishRecovery(auth)).toEqual({ ok: false, error: "sign-out" });
  });

  it("never claims global revocation when the proof session has already gone", async () => {
    auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    expect(await finishRecovery(auth)).toMatchObject({ ok: false, error: "invalid", message: expect.stringContaining("Password saved.") });
    expect(auth.admin.signOut).not.toHaveBeenCalled();
  });

  it("handles getUser and update outages without leaking details", async () => {
    auth.getUser.mockRejectedValueOnce(new Error("private provider detail"));
    expect(await saveRecoveryPassword(auth, password, password)).toEqual({ ok: false, error: "unavailable" });
    auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { status: 503 } });
    expect(await saveRecoveryPassword(auth, password, password)).toEqual({ ok: false, error: "unavailable" });
    auth.updateUser.mockRejectedValueOnce(new Error("private provider detail"));
    expect(await saveRecoveryPassword(auth, password, password)).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("recovery destinations and shared form validation", () => {
  it("preserves the original wizard destination through reset and login", () => {
    const next = "/jobs/new?step=review&draft=1";
    expect(recoveryPath(next)).toBe("/recovery?next=%2Fjobs%2Fnew%3Fstep%3Dreview%26draft%3D1");
    expect(recoveryLoginPath(next)).toBe("/login?next=%2Fjobs%2Fnew%3Fstep%3Dreview%26draft%3D1");
  });

  it.each(["https://evil.example", "//evil.example", "/recovery", "/login?next=/recovery", "/verify", "/signup/customer"])("rejects external destinations and auth loops: %s", (next) => {
    expect(recoveryNext(next)).toBeNull();
    expect(recoveryLoginPath(next)).toBe("/login");
  });

  it("uses the configured Vercel production host instead of an unbought canonical domain", () => {
    expect(recoveryEmailUrl("/jobs/new", { VERCEL_PROJECT_PRODUCTION_URL: "main-ashy-tau.vercel.app" })).toBe("https://main-ashy-tau.vercel.app/recovery/confirm?next=%2Fjobs%2Fnew");
    expect(recoveryEmailUrl("//evil.example", {})).toBe("https://trademarketplace.nz/recovery/confirm?next=%2F");
    expect(recoveryEmailUrl(null, { VERCEL_PROJECT_PRODUCTION_URL: "evil.example/path" })).toBe("https://trademarketplace.nz/recovery/confirm?next=%2F");
  });

  it("checks matching passwords and wall-clock countdowns", () => {
    expect(recoveryPasswordErrors(password, password)).toEqual({ password: undefined, confirmation: undefined });
    expect(recoveryPasswordErrors(password, "other").confirmation).toBe("These don’t match.");
    expect(recoverySeconds(60_000, 59_001)).toBe(1);
    expect(recoverySeconds(60_000, 90_000)).toBe(0);
    expect(recoverySeconds(999_999, 0)).toBe(60);
  });
});
