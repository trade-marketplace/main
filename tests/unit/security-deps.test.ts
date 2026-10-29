import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({ update: vi.fn(), proof: { signInWithPassword: vi.fn(), signOut: vi.fn() }, auth: { existingSession: true }, createClient: vi.fn() }));
vi.mock("@/server/db", () => ({ getDb: () => ({ profile: { updateMany: fakes.update } }) }));
vi.mock("@/server/supabase", () => ({ createSupabaseServerClient: async () => ({ auth: fakes.auth }) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: fakes.createClient }));
vi.mock("@/lib/supabase/config", () => ({ supabaseConfig: () => ({ url: "http://127.0.0.1:54322", publishableKey: "local-test-key" }) }));

const { syncSecurityEmail, securityDeps } = await import("@/server/auth/security-deps");
const user = { id: "user-1", email: "sarah@example.test", email_confirmed_at: "2026-01-01T00:00:00Z" };

beforeEach(() => {
  vi.clearAllMocks();
  fakes.createClient.mockReturnValue({ auth: fakes.proof });
  fakes.proof.signInWithPassword.mockResolvedValue({ data: { user }, error: null });
  fakes.proof.signOut.mockResolvedValue({ error: null });
});

describe("independent email verification (#106 compatibility)", () => {
  it("visiting Security never verifies the current email from Auth's automatic confirmation timestamp", async () => {
    await syncSecurityEmail(user);
    expect(fakes.update).toHaveBeenCalledWith({ where: { id: user.id, email: { not: user.email } }, data: { email: user.email, emailVerifiedAt: null } });
  });
  it("an email link that has actually been exchanged can mark the matching email verified", async () => {
    await syncSecurityEmail(user, true);
    expect(fakes.update).toHaveBeenCalledWith({ where: { id: user.id, OR: [{ email: { not: user.email } }, { emailVerifiedAt: null }] }, data: { email: user.email, emailVerifiedAt: expect.any(Date) } });
  });
  it("no email means no profile update", async () => {
    await syncSecurityEmail({ id: user.id }); expect(fakes.update).not.toHaveBeenCalled();
  });
});

describe("password proof uses a separate client", () => {
  it("never replaces the current cookie client and always disposes of the temporary session", async () => {
    const deps = await securityDeps();
    expect(deps.auth).toBe(fakes.auth);
    await deps.verifyPassword(user.email, "test password");
    expect(fakes.createClient).toHaveBeenCalledWith("http://127.0.0.1:54322", "local-test-key", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    expect(fakes.proof.signInWithPassword).toHaveBeenCalledWith({ email: user.email, password: "test password" });
    expect(fakes.proof.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("a password-check exception still disposes of the temporary session", async () => {
    fakes.proof.signInWithPassword.mockRejectedValue(new Error("network"));
    await expect((await securityDeps()).verifyPassword(user.email, "test password")).rejects.toThrow("network");
    expect(fakes.proof.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
