import { beforeEach, describe, expect, it, vi } from "vitest";

import { verificationDestination, verificationPath, verificationSeconds } from "@/lib/auth/verification";
import { confirmVerification, sendVerification, type VerificationAuth, type VerificationProfiles } from "@/server/auth/email-verification";

const now = new Date("2026-10-29T08:00:00Z");
const profile = { id: "user-1", email: "sarah@example.test", firstName: "Sarah", role: "CUSTOMER" as const, emailVerifiedAt: null };
const auth = {
  signInWithOtp: vi.fn<VerificationAuth["signInWithOtp"]>(),
  verifyOtp: vi.fn<VerificationAuth["verifyOtp"]>(),
  signOut: vi.fn<VerificationAuth["signOut"]>(),
};
const profiles = {
  find: vi.fn<VerificationProfiles["find"]>(),
  markVerified: vi.fn<VerificationProfiles["markVerified"]>(),
};

beforeEach(() => {
  vi.resetAllMocks();
  auth.signInWithOtp.mockResolvedValue({ error: null });
  auth.verifyOtp.mockResolvedValue({ data: { user: { id: profile.id, email: profile.email } }, error: null });
  auth.signOut.mockResolvedValue({ error: null });
  profiles.find.mockResolvedValue(profile);
  profiles.markVerified.mockResolvedValue(true);
});

describe("requesting email proof", () => {
  it("sends a one-time link without creating accounts, with a 60 second cooldown", async () => {
    expect(await sendVerification(auth, " SARAH@example.test ", "/callback", now.getTime())).toEqual({ ok: true, email: profile.email, retryAt: now.getTime() + 60_000 });
    expect(auth.signInWithOtp).toHaveBeenCalledWith({ email: profile.email, options: { shouldCreateUser: false, emailRedirectTo: "/callback" } });
  });

  it("rejects invalid addresses before calling Auth", async () => {
    expect(await sendVerification(auth, "not-email", "/callback")).toEqual({ ok: false, error: "invalid-email" });
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  for (const code of ["otp_disabled", "user_not_found", "signup_disabled"]) {
    it(`does not reveal missing accounts (${code})`, async () => {
      auth.signInWithOtp.mockResolvedValue({ error: { code } });
      expect(await sendVerification(auth, profile.email, "/callback", now.getTime())).toMatchObject({ ok: true });
    });
  }

  it("honours provider throttling", async () => {
    auth.signInWithOtp.mockResolvedValue({ error: { status: 429 } });
    expect(await sendVerification(auth, profile.email, "/callback", now.getTime())).toEqual({ ok: false, error: "try-later", retryAt: now.getTime() + 60_000 });
  });

  it("handles delivery errors and network failures without leaking provider details", async () => {
    auth.signInWithOtp.mockResolvedValueOnce({ error: { code: "unexpected_failure" } });
    expect(await sendVerification(auth, profile.email, "/callback")).toEqual({ ok: false, error: "unavailable" });
    auth.signInWithOtp.mockRejectedValueOnce(new Error("private service details"));
    expect(await sendVerification(auth, profile.email, "/callback")).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("confirming email ownership", () => {
  it("marks only the email proved by the server token and revokes only the temporary session", async () => {
    expect(await confirmVerification(auth, profiles, "one-time-token", "email", now)).toBe("verified");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "one-time-token", type: "email" });
    expect(profiles.markVerified).toHaveBeenCalledWith(profile.id, profile.email, now);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("already verified stays friendly without changing the original proof timestamp", async () => {
    profiles.find.mockResolvedValue({ ...profile, emailVerifiedAt: now });
    expect(await confirmVerification(auth, profiles, "valid-token", "email")).toBe("verified");
    expect(profiles.markVerified).not.toHaveBeenCalled();
  });

  it("expired or reused links cannot mark a profile verified", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: null }, error: { code: "otp_expired" } });
    expect(await confirmVerification(auth, profiles, "expired-token", "email")).toBe("expired");
    expect(profiles.find).not.toHaveBeenCalled();
    expect(profiles.markVerified).not.toHaveBeenCalled();
  });

  it("invalid tokens and unrelated link types cannot change verification", async () => {
    for (const [token, type] of [[null, "email"], ["token", "recovery"], ["token", "email_change"], ["token", null]]) {
      expect(await confirmVerification(auth, profiles, token, type)).toBe("invalid");
    }
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    auth.verifyOtp.mockResolvedValue({ data: { user: null }, error: { code: "validation_failed" } });
    expect(await confirmVerification(auth, profiles, "invalid-token", "email")).toBe("invalid");
    expect(profiles.markVerified).not.toHaveBeenCalled();
  });

  it("cannot apply proof to a different or missing profile email", async () => {
    profiles.find.mockResolvedValueOnce({ ...profile, email: "changed@example.test" }).mockResolvedValueOnce(null);
    expect(await confirmVerification(auth, profiles, "token", "email")).toBe("invalid");
    expect(await confirmVerification(auth, profiles, "token", "email")).toBe("invalid");
    expect(profiles.markVerified).not.toHaveBeenCalled();
    expect(auth.signOut).toHaveBeenCalledTimes(2);
  });

  it("handles an email change racing the verified update", async () => {
    profiles.markVerified.mockResolvedValue(false);
    expect(await confirmVerification(auth, profiles, "token", "email")).toBe("invalid");
  });

  it("cleans up its temporary session after a database error", async () => {
    profiles.markVerified.mockRejectedValue(new Error("private database details"));
    expect(await confirmVerification(auth, profiles, "token", "email")).toBe("unavailable");
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("handles an Auth outage without claiming the link expired", async () => {
    auth.verifyOtp.mockResolvedValueOnce({ data: { user: null }, error: { status: 503 } });
    expect(await confirmVerification(auth, profiles, "token", "email")).toBe("unavailable");
    auth.verifyOtp.mockRejectedValueOnce(new Error("network failure"));
    expect(await confirmVerification(auth, profiles, "token", "email")).toBe("unavailable");
  });
});

describe("verification return paths and countdown", () => {
  it("preserves wizard search parameters through verification and password login", () => {
    const next = "/jobs/new?step=review&draft=1";
    expect(verificationPath(next)).toBe("/verify?next=%2Fjobs%2Fnew%3Fstep%3Dreview%26draft%3D1");
    expect(verificationDestination(undefined, next)).toBe("/login?next=%2Fjobs%2Fnew%3Fstep%3Dreview%26draft%3D1");
    expect(verificationDestination("CUSTOMER", next)).toBe(next);
  });

  it("rejects external destinations, verification loops and wrong-role paths", () => {
    for (const next of ["https://evil.example", "//evil.example", "/verify?next=/verify"]) {
      expect(verificationDestination(undefined, next)).toBe("/login");
      expect(verificationDestination("CUSTOMER", next)).toBe("/");
    }
    expect(verificationDestination("TRADIE", "/jobs/new")).toBe("/jobs");
  });

  it("counts elapsed wall time, including a tab suspended longer than the cooldown", () => {
    expect(verificationSeconds(60_000, 0)).toBe(60);
    expect(verificationSeconds(60_000, 59_001)).toBe(1);
    expect(verificationSeconds(60_000, 90_000)).toBe(0);
  });
});
