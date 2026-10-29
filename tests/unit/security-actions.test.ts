import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({ authorize: vi.fn(), deps: vi.fn(), change: vi.fn(), revalidate: vi.fn(), signOut: vi.fn() }));
vi.mock("@/server/supabase", () => ({ createSupabaseServerClient: async () => ({ auth: { signOut: fakes.signOut } }) }));
vi.mock("@/server/auth/guard", async (original) => {
  const real = await original<typeof import("@/server/auth/guard")>();
  return { ...real, withRole: real.createGuards(async () => fakes.authorize()).withRole };
});
vi.mock("@/server/auth/security-deps", () => ({ securityDeps: fakes.deps }));
vi.mock("@/server/auth/security", () => ({ changeSecurity: fakes.change }));
vi.mock("next/cache", () => ({ revalidatePath: fakes.revalidate }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://preview.example.test" }) }));
const { securityAction, endSecuritySessionAction } = await import("@/server/auth/security-actions");

beforeEach(() => {
  vi.clearAllMocks();
  fakes.authorize.mockResolvedValue({ userId: "verified-user", role: "CUSTOMER" });
  fakes.deps.mockResolvedValue({ auth: "fake" });
  fakes.change.mockResolvedValue({ ok: true, status: "password-changed" });
  fakes.signOut.mockResolvedValue({ error: null });
});

describe("security server action", () => {
  it("reauthentication clears only this browser's session", async () => {
    expect(await endSecuritySessionAction()).toEqual({ ok: true });
    expect(fakes.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("takes identity from the server and preserves the preview origin for email confirmation", async () => {
    const form = new FormData(); form.set("userId", "forged"); form.set("currentPassword", "current");
    await securityAction("password", null, form);
    expect(fakes.authorize).toHaveBeenCalledOnce();
    expect(fakes.change).toHaveBeenCalledWith({ auth: "fake" }, "verified-user", expect.objectContaining({ currentPassword: "current" }), "https://preview.example.test/profile/security/confirm");
    expect(fakes.revalidate).toHaveBeenCalledWith("/", "layout");
  });
  it("rejects expired sessions before constructing clients or reading form values", async () => {
    fakes.authorize.mockResolvedValue(null);
    expect(await securityAction("password", null, new FormData())).toMatchObject({ ok: false, error: "session-expired" });
    expect(fakes.deps).not.toHaveBeenCalled(); expect(fakes.change).not.toHaveBeenCalled();
  });
  it("refuses the office role before reading or changing account data", async () => {
    fakes.authorize.mockResolvedValue({ userId: "office", role: "ADMIN" });
    expect(await securityAction("password", null, new FormData())).toEqual({ ok: false, error: "forbidden" });
    expect(fakes.deps).not.toHaveBeenCalled();
  });
  it("rejects an unknown operation from a forged action request", async () => {
    // @ts-expect-error Untrusted serialized action input can break the TS type.
    expect(await securityAction("promote-admin", null, new FormData())).toMatchObject({ ok: false });
    expect(fakes.deps).not.toHaveBeenCalled();
  });
  it("unavailable configuration returns a retryable result without throwing", async () => {
    fakes.deps.mockRejectedValue(new Error("not configured"));
    expect(await securityAction("password", null, new FormData())).toEqual({ ok: false, error: "unavailable" });
    expect(fakes.revalidate).not.toHaveBeenCalled();
  });
  it("a failed operation does not claim success by refreshing the page", async () => {
    fakes.change.mockResolvedValue({ ok: false, error: "wrong-password" });
    expect(await securityAction("password", null, new FormData())).toEqual({ ok: false, error: "wrong-password" });
    expect(fakes.revalidate).not.toHaveBeenCalled();
  });
});
