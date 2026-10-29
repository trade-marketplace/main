import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestCookies = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({
  getAll: () => [...requestCookies].map(([name, value]) => ({ name, value })),
  set: (name: string, value: string) => { if (value) requestCookies.set(name, value); else requestCookies.delete(name); },
}) }));

const { confirmRecovery, finishRecovery, saveRecoveryPassword } = await import("@/server/auth/password-recovery");
const { recoveryClientWithCookies } = await import("@/server/auth/recovery");
const { defaultRefreshSources } = await import("@/server/auth/refresh");
const { loadViewer, readUserIdFromCookies } = await import("@/server/auth/viewer");

const user = { id: "11111111-1111-4111-8111-111111111111", email: "sarah@example.test", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-10-29T00:00:00Z" };
const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const accessToken = (session: string) => `${base64url({ alg: "RS256", kid: "stub-key", typ: "JWT" })}.${base64url({ sub: user.id, session_id: session, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })}.stub-signature`;
const session = (id: string) => ({ access_token: accessToken(id), refresh_token: `${id}-refresh`, expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer", user });
const encoded = (id: string) => `base64-${base64url(session(id))}`;
const password = "korimako-gumboot-41";

beforeEach(() => {
  requestCookies.clear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("NODE_ENV", "production");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("the real SDK with a fake Auth boundary, never a Supabase project", () => {
  it("keeps recovery separate, consumes its link once, retries real revocation, and blocks unexpired old-device JWTs", async () => {
    const active = new Set(["device-one", "device-two", "recovery"]);
    let used = false;
    let failLogout = true;
    let updates = 0;
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.origin !== "https://auth.example.test") throw new Error("Unexpected network request");
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url.pathname}${url.search}`);
      if (url.pathname === "/auth/v1/verify") {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ type: "recovery", token_hash: "one-time-proof" });
        if (used) return Response.json({ error_code: "otp_expired", msg: "Invalid or expired" }, { status: 403 });
        used = true;
        return Response.json(session("recovery"));
      }
      const authorization = new Headers(init?.headers).get("authorization")?.replace("Bearer ", "");
      const claims = authorization ? JSON.parse(Buffer.from(authorization.split(".")[1], "base64url").toString()) : null;
      if (!claims || !active.has(claims.session_id)) return Response.json({ error_code: "session_not_found", msg: "Session revoked" }, { status: 403 });
      if (url.pathname === "/auth/v1/user") {
        if (method === "PUT") {
          expect(JSON.parse(String(init?.body))).toMatchObject({ password });
          updates += 1;
        }
        return Response.json(user);
      }
      if (url.pathname === "/auth/v1/logout") {
        expect(url.searchParams.get("scope")).toBe("global");
        if (failLogout) return Response.json({ error_code: "unexpected_failure", msg: "Temporary outage" }, { status: 500 });
        active.clear();
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected fake Auth endpoint: ${url.pathname}`);
    }));

    requestCookies.set("sb-auth-auth-token", encoded("device-one"));
    const original = requestCookies.get("sb-auth-auth-token");
    expect(await readUserIdFromCookies()).toBe(user.id);
    const proofCookies = new Map<string, string>();
    const cookieOptions: unknown[] = [];
    const proofJar = {
      getAll: () => [...proofCookies].map(([name, value]) => ({ name, value })),
      setAll: (values: { name: string; value: string; options: object }[]) => {
        for (const cookie of values) { proofCookies.set(cookie.name, cookie.value); cookieOptions.push(cookie.options); }
      },
    };
    const recovery = recoveryClientWithCookies(proofJar);
    expect(await confirmRecovery(recovery.auth, "one-time-proof", "recovery")).toBe("reset");
    expect(proofCookies.has("tm-recovery-auth")).toBe(true);
    expect(cookieOptions).toContainEqual(expect.objectContaining({ path: "/recovery", httpOnly: true, secure: true, sameSite: "lax", maxAge: 3600 }));
    expect(requestCookies.get("sb-auth-auth-token")).toBe(original);
    const anotherBrowser = recoveryClientWithCookies({ getAll: () => [], setAll: () => {} });
    expect(await confirmRecovery(anotherBrowser.auth, "one-time-proof", "recovery")).toBe("expired");
    expect(await saveRecoveryPassword(recovery.auth, password, password)).toEqual({ ok: true });
    expect(updates).toBe(1);
    expect(await finishRecovery(recovery.auth)).toEqual({ ok: false, error: "sign-out" });
    expect(proofCookies.get("tm-recovery-auth")).toContain("base64-");
    expect(active.has("device-two")).toBe(true);
    failLogout = false;
    expect(await finishRecovery(recovery.auth)).toEqual({ ok: true });
    expect(updates).toBe(1);
    expect(active.size).toBe(0);

    const findProfile = vi.fn();
    expect(await loadViewer({ readUserId: readUserIdFromCookies, findProfile })).toBeNull();
    expect(findProfile).not.toHaveBeenCalled();
    const deviceTwo = { getAll: () => [{ name: "sb-auth-auth-token", value: encoded("device-two") }], setAll: () => {} };
    expect(await defaultRefreshSources.readUserId(deviceTwo)).toBeNull();
    expect(calls).toContain("POST /auth/v1/logout?scope=global");
    expect(calls.some((call) => call.includes("jwks"))).toBe(false);
  });
});
