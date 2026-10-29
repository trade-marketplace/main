import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ viewer: vi.fn(), pending: vi.fn(), send: vi.fn(), confirm: vi.fn(), signOut: vi.fn(), setCookie: vi.fn(), deleteCookie: vi.fn(), complete: false }));
vi.mock("@/server/auth/viewer", () => ({ getViewer: fake.viewer }));
vi.mock("@/server/auth/verification", () => ({
  pendingVerification: fake.pending,
  startVerification: fake.send,
  verificationTiming: (retryAt: number) => ({ retryAt, seconds: 0 }),
  verificationAuth: () => ({}),
  verificationProfiles: {},
  VERIFICATION_COMPLETE_COOKIE: "tm-verification-complete",
  VERIFICATION_PENDING_COOKIE: "tm-verification-pending",
}));
vi.mock("@/server/auth/email-verification", () => ({ confirmVerification: fake.confirm }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => fake.complete ? { value: "1" } : undefined, set: fake.setCookie, delete: fake.deleteCookie }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", async (original) => ({ ...(await original<typeof import("next/navigation")>()), redirect: (to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); } }));
vi.mock("@/server/supabase", async (original) => ({ ...(await original<typeof import("@/server/supabase")>()), createSupabaseServerClient: async () => ({ auth: { signOut: fake.signOut } }) }));

const { default: VerifyPage } = await import("@/app/verify/page");
const { GET } = await import("@/app/verify/confirm/route");
const { resendVerificationAction, verificationStatusAction, changeVerificationAccountAction } = await import("@/server/auth/verification-actions");

beforeEach(() => {
  vi.resetAllMocks();
  fake.complete = false;
  fake.viewer.mockResolvedValue(null);
  fake.pending.mockResolvedValue(null);
  fake.send.mockResolvedValue({ ok: true, email: "sarah@example.test", retryAt: 60_000 });
  fake.confirm.mockResolvedValue("verified");
  fake.signOut.mockResolvedValue({ error: null });
});

const viewer = { userId: "user-1", email: "sarah@example.test", role: "CUSTOMER", firstName: "Sarah", emailVerified: false };

describe("verification page and polling", () => {
  it("cannot show verification success from query flags or another account's success marker", async () => {
    const result = await VerifyPage({ searchParams: Promise.resolve({ state: "verified", email: "private@example.test" }) });
    expect(result.props.initialState).toBe("ready");
    expect(result.props.initialEmail).toBe("");
    fake.viewer.mockResolvedValue(viewer);
    fake.complete = true;
    expect((await VerifyPage({ searchParams: Promise.resolve({}) })).props.initialState).toBe("ready");
    expect((await verificationStatusAction()).verified).toBe(false);
  });

  it("already verified wins over an expired or reused link", async () => {
    fake.viewer.mockResolvedValue({ ...viewer, emailVerified: true });
    const result = await VerifyPage({ searchParams: Promise.resolve({ state: "expired", next: "/jobs/new?step=review" }) });
    expect(result.props.initialState).toBe("verified");
    expect(result.props.continueTo).toBe("/jobs/new?step=review");
    expect(await verificationStatusAction("/jobs/new?step=review")).toEqual({ verified: true, redirectTo: "/jobs/new?step=review" });
  });

  it("moves a signed-out holding tab to password login after proof in another tab", async () => {
    fake.complete = true;
    expect(await verificationStatusAction("/jobs/new?step=review")).toEqual({ verified: true, redirectTo: "/login?next=%2Fjobs%2Fnew%3Fstep%3Dreview" });
  });

  it("does not use a pending email's cooldown for a different signed-in account", async () => {
    fake.viewer.mockResolvedValue(viewer);
    fake.pending.mockResolvedValue({ email: "other@example.test", retryAt: 999_999_999_999 });
    const result = await VerifyPage({ searchParams: Promise.resolve({}) });
    expect(result.props.initialEmail).toBe(viewer.email);
    expect(result.props.initialRetryAt).toBe(0);
  });

  it("keeps the page usable when profile lookup fails", async () => {
    fake.viewer.mockRejectedValue(new Error("private database details"));
    expect((await VerifyPage({ searchParams: Promise.resolve({}) })).props.initialState).toBe("unavailable");
  });
});

describe("resending", () => {
  it("uses the authenticated profile email instead of an attacker-supplied address", async () => {
    fake.viewer.mockResolvedValue(viewer);
    await resendVerificationAction("other@example.test", "/jobs/new");
    expect(fake.send).toHaveBeenCalledWith(viewer.email, "/jobs/new");
  });

  it("enforces the pending cooldown on the server", async () => {
    const retryAt = Date.now() + 30_000;
    fake.pending.mockResolvedValue({ email: viewer.email, retryAt });
    expect(await resendVerificationAction(viewer.email)).toEqual({ ok: false, error: "try-later", retryAt });
    expect(fake.send).not.toHaveBeenCalled();
  });

  it("handles session lookup errors without exposing private details", async () => {
    fake.viewer.mockRejectedValue(new Error("private database details"));
    expect(await resendVerificationAction(viewer.email)).toEqual({ ok: false, error: "unavailable" });
  });

  it("using another account clears only this browser and its email hints, preserving the return path", async () => {
    const form = new FormData();
    form.set("next", "/jobs/new?step=review");
    await expect(changeVerificationAccountAction(form)).rejects.toMatchObject({ to: "/signup?next=%2Fjobs%2Fnew%3Fstep%3Dreview" });
    expect(fake.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(fake.deleteCookie).toHaveBeenCalledWith("tm-verification-complete");
    expect(fake.setCookie).toHaveBeenCalledWith("tm-verification-pending", "", { path: "/verify", maxAge: 0 });
  });
});

describe("email callback", () => {
  it("checks the token and issues only an informational cookie, with no browser login", async () => {
    const response = await GET(new NextRequest("https://trademarketplace.nz/verify/confirm?token_hash=proof&type=email&next=%2Fjobs%2Fnew"));
    expect(fake.confirm).toHaveBeenCalledWith({}, {}, "proof", "email");
    expect(response.headers.get("location")).toBe("https://trademarketplace.nz/verify?next=%2Fjobs%2Fnew");
    expect(response.cookies.getAll().map((cookie) => cookie.name)).toEqual(["tm-verification-complete"]);
    expect(response.cookies.get("tm-verification-complete")).toMatchObject({ httpOnly: true, sameSite: "lax", maxAge: 86_400 });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  for (const state of ["expired", "invalid", "unavailable"]) {
    it(`returns a recoverable ${state} state, never an external redirect or success cookie`, async () => {
      fake.confirm.mockResolvedValue(state);
      const response = await GET(new NextRequest("https://trademarketplace.nz/verify/confirm?token_hash=bad&type=email&next=https://evil.example"));
      const location = new URL(response.headers.get("location")!);
      expect(location.origin).toBe("https://trademarketplace.nz");
      expect(location.searchParams.get("next")).toBe("/");
      expect(location.searchParams.get("state")).toBe(state);
      expect(response.cookies.getAll()).toEqual([]);
    });
  }
});
