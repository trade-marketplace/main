import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ values: new Map<string, string>(), set: vi.fn(), getUser: vi.fn(), verify: vi.fn(), send: vi.fn(), save: vi.fn(), finish: vi.fn(), normalSignOut: vi.fn(), revalidate: vi.fn(), providerCookie: "" }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => fake.values.has(name) ? { value: fake.values.get(name) } : undefined,
  getAll: () => [...fake.values].map(([name, value]) => ({ name, value })),
  set: fake.set,
}) }));
vi.mock("next/cache", () => ({ revalidatePath: fake.revalidate }));
vi.mock("@/server/auth/password-recovery", () => ({ confirmRecovery: fake.verify, sendRecovery: fake.send, saveRecoveryPassword: fake.save, finishRecovery: fake.finish }));
vi.mock("@/server/auth/verification", () => ({ verificationAuth: () => ({ request: "stateless" }) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: (_url: string, _key: string, options: { cookieOptions: { name: string }; cookies: { getAll: () => { name: string; value: string }[]; setAll: (cookies: unknown[], headers: object) => void } }) => {
  fake.providerCookie = options.cookieOptions.name;
  return { auth: { getUser: fake.getUser, callbackCookies: options.cookies, sendTokens: () => options.cookies.setAll([{ name: "tm-recovery-auth", value: "proof-session", options: { httpOnly: true, secure: true, sameSite: "lax", path: "/recovery", maxAge: 3600 } }], {}) } };
} }));
vi.mock("@/server/supabase", async (original) => ({ ...(await original<typeof import("@/server/supabase")>()), createSupabaseServerClient: async () => ({ auth: { signOut: fake.normalSignOut } }) }));

const { default: RecoveryPage } = await import("@/app/recovery/page");
const { GET } = await import("@/app/recovery/confirm/route");
const { requestRecoveryAction, saveRecoveryAction } = await import("@/server/auth/recovery-actions");

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
  fake.values.clear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  fake.set.mockImplementation((name: string, value: string) => { if (value) fake.values.set(name, value); else fake.values.delete(name); });
  fake.getUser.mockResolvedValue({ data: { user: { id: "user-1", email: "proved@example.test" } }, error: null });
  fake.verify.mockImplementation(async (auth) => { auth.sendTokens(); return "reset"; });
  fake.send.mockResolvedValue({ ok: true, email: "sarah@example.test", retryAt: Date.now() + 60_000 });
  fake.save.mockResolvedValue({ ok: true });
  fake.finish.mockResolvedValue({ ok: true });
  fake.normalSignOut.mockResolvedValue({ error: null });
});

describe("recovery pages", () => {
  it("does not trust query flags as reset authorization, completion or a recipient", async () => {
    const page = await RecoveryPage({ searchParams: Promise.resolve({ state: "reset", email: "private@example.test", next: "https://evil.example" }) });
    expect(page.props.initialState).toBe("invalid");
    expect(page.props.initialEmail).toBe("");
    expect(page.props.next).toBeUndefined();
    expect(fake.getUser).not.toHaveBeenCalled();
    expect((await RecoveryPage({ searchParams: Promise.resolve({ state: "complete" }) })).props.initialState).toBe("request");
  });

  it("uses the server-proved address instead of the pending request's address", async () => {
    fake.values.set("tm-recovery-auth.0", "proof-session");
    fake.values.set("tm-recovery-pending", JSON.stringify({ email: "other@example.test", retryAt: 0 }));
    const page = await RecoveryPage({ searchParams: Promise.resolve({ next: "/jobs/new?step=review" }) });
    expect(page.props.initialState).toBe("reset");
    expect(page.props.initialEmail).toBe("proved@example.test");
    expect(page.props.next).toBe("/jobs/new?step=review");
    expect(fake.providerCookie).toBe("tm-recovery-auth");
  });

  it("distinguishes an expired session from an Auth outage", async () => {
    fake.values.set("tm-recovery-auth", "proof-session");
    fake.getUser.mockResolvedValueOnce({ data: { user: null }, error: { status: 403 } }).mockResolvedValueOnce({ data: { user: null }, error: { status: 503 } }).mockRejectedValueOnce(new Error("private provider details"));
    expect((await RecoveryPage({ searchParams: Promise.resolve({}) })).props.initialState).toBe("expired");
    expect((await RecoveryPage({ searchParams: Promise.resolve({}) })).props.initialState).toBe("unavailable");
    expect((await RecoveryPage({ searchParams: Promise.resolve({}) })).props.initialState).toBe("unavailable");
  });

  it("recovers the finish-only stage after a reload without storing passwords", async () => {
    fake.values.set("tm-recovery-auth", "proof-session");
    fake.values.set("tm-recovery-saved", "1");
    expect((await RecoveryPage({ searchParams: Promise.resolve({}) })).props.initialState).toBe("finish");
    expect(fake.getUser).not.toHaveBeenCalled();
  });
});

describe("request action", () => {
  it("stores only the pending address/cooldown on success and honors it on the server", async () => {
    const first = await requestRecoveryAction("sarah@example.test", "/jobs/new");
    expect(first.ok).toBe(true);
    expect(fake.send).toHaveBeenCalledWith({ request: "stateless" }, "sarah@example.test", expect.stringContaining("/recovery/confirm?next=%2Fjobs%2Fnew"));
    expect(fake.set).toHaveBeenCalledWith("tm-recovery-pending", expect.stringContaining("sarah@example.test"), expect.objectContaining({ httpOnly: true, path: "/recovery", maxAge: 3600 }));
    expect(await requestRecoveryAction("sarah@example.test")).toMatchObject({ ok: false, error: "try-later" });
    expect(fake.send).toHaveBeenCalledTimes(1);
  });

  it("keeps network errors generic and doesn't write a success hint on failure", async () => {
    fake.send.mockRejectedValueOnce(new Error("private error"));
    expect(await requestRecoveryAction("sarah@example.test")).toEqual({ ok: false, error: "unavailable" });
    expect(fake.set).not.toHaveBeenCalled();
  });
});

describe("password action", () => {
  it("updates once, revokes every device, clears both sessions and then acknowledges completion", async () => {
    fake.values.set("tm-recovery-auth.0", "proof-session");
    expect(await saveRecoveryAction("korimako-gumboot-41", "korimako-gumboot-41")).toEqual({ ok: true });
    expect(fake.save).toHaveBeenCalledOnce();
    expect(fake.finish).toHaveBeenCalledOnce();
    expect(fake.set).toHaveBeenCalledWith("tm-recovery-auth.0", "", expect.objectContaining({ path: "/recovery", maxAge: 0 }));
    expect(fake.set).toHaveBeenCalledWith("tm-recovery-complete", "1", expect.objectContaining({ httpOnly: true, path: "/recovery" }));
    expect(fake.normalSignOut).toHaveBeenCalledWith({ scope: "local" });
    expect(fake.revalidate).toHaveBeenCalledWith("/", "layout");
    expect(JSON.stringify(fake.set.mock.calls)).not.toContain("korimako-gumboot-41");
  });

  it("does not show success if session revocation failed; retry only revokes, never resets twice", async () => {
    fake.values.set("tm-recovery-auth", "proof-session");
    fake.finish.mockResolvedValueOnce({ ok: false, error: "sign-out" });
    expect(await saveRecoveryAction("korimako-gumboot-41", "korimako-gumboot-41")).toEqual({ ok: false, error: "sign-out" });
    expect(fake.values.get("tm-recovery-saved")).toBe("1");
    expect(fake.values.has("tm-recovery-complete")).toBe(false);
    expect(await saveRecoveryAction("", "")).toEqual({ ok: true });
    expect(fake.save).toHaveBeenCalledTimes(1);
    expect(fake.finish).toHaveBeenCalledTimes(2);
  });

  it("clears expired proof and never revokes sessions when validation fails", async () => {
    fake.values.set("tm-recovery-auth", "expired");
    fake.save.mockResolvedValueOnce({ ok: false, error: "invalid" });
    expect(await saveRecoveryAction("strong-password-41", "strong-password-41")).toEqual({ ok: false, error: "invalid" });
    expect(fake.finish).not.toHaveBeenCalled();
    expect(fake.values.has("tm-recovery-auth")).toBe(false);
  });
});

describe("recovery link callback", () => {
  it("creates an isolated proof session with no ordinary login cookie and strips the token from the redirect", async () => {
    const request = new NextRequest("https://site.test/recovery/confirm?token_hash=secret-proof&type=recovery&next=%2Fjobs%2Fnew", { headers: { cookie: "sb-ref-auth-token=existing-login; tm-recovery-auth.0=old-proof" } });
    const response = await GET(request);
    expect(fake.verify).toHaveBeenCalledWith(expect.anything(), "secret-proof", "recovery");
    expect(response.headers.get("location")).toBe("https://site.test/recovery?next=%2Fjobs%2Fnew&state=reset");
    expect(response.cookies.get("tm-recovery-auth")).toMatchObject({ value: "proof-session", httpOnly: true, secure: true, path: "/recovery", maxAge: 3600 });
    expect(response.cookies.get("tm-recovery-auth.0")?.maxAge).toBe(0);
    expect(response.cookies.get("sb-ref-auth-token")).toBeUndefined();
    const auth = fake.verify.mock.calls[0][0];
    expect(auth.callbackCookies.getAll()).toEqual([]);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it.each(["expired", "invalid", "unavailable"])("never writes proof cookies for %s links or leaves old proof active", async (state) => {
    fake.verify.mockImplementation(async (auth) => { auth.sendTokens(); return state; });
    const response = await GET(new NextRequest("https://site.test/recovery/confirm?token_hash=bad&type=recovery&next=https://evil.example", { headers: { cookie: "tm-recovery-auth=old-proof" } }));
    const destination = new URL(response.headers.get("location")!);
    expect(destination.origin).toBe("https://site.test");
    expect(destination.searchParams.get("state")).toBe(state);
    expect(destination.searchParams.has("next")).toBe(false);
    expect(response.cookies.getAll().every((cookie) => cookie.value === "")).toBe(true);
  });
});
