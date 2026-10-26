import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/lib/mode";
import { defaultRefreshSources, refreshSession, type RefreshSources } from "@/server/auth/refresh";
import { config } from "@/proxy";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const SITE = "https://trademarketplace.nz";

function page(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(new URL(path, SITE), init);
}

/** Sources where the visitor is `role` (null = signed out), optionally refreshing their cookie on the way. */
function sources(role: Role | null, options: { refreshTo?: string } = {}) {
  return {
    readUserId: vi.fn<RefreshSources["readUserId"]>(async (jar) => {
      if (options.refreshTo) {
        jar.setAll(
          [{ name: "sb-ref-auth-token", value: options.refreshTo, options: { httpOnly: true, path: "/" } }],
          { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0" },
        );
      }
      return role ? "user-1" : null;
    }),
    findRole: vi.fn<RefreshSources["findRole"]>(async () => role),
  };
}

describe("refreshSession (the proxy)", () => {
  it("redirects a signed-out visit to an app page to log in, keeping the page", async () => {
    const response = await refreshSession(page("/dashboard?tab=active"), sources(null));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${SITE}/login?next=%2Fdashboard%3Ftab%3Dactive`);
  });

  it("redirects a tradie who opens a customer-only page to their home", async () => {
    const response = await refreshSession(page("/jobs/new"), sources("TRADIE"));
    expect(response.headers.get("location")).toBe(`${SITE}/jobs`);
  });

  it("lets the right role through", async () => {
    const response = await refreshSession(page("/jobs/new"), sources("CUSTOMER"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("doesn't read the role for public pages (no database read)", async () => {
    const fake = sources("TRADIE");
    const response = await refreshSession(page("/help/paying"), fake);
    expect(response.headers.get("location")).toBeNull();
    expect(fake.findRole).not.toHaveBeenCalled();
  });

  it("still refreshes the session on public pages", async () => {
    const fake = sources("TRADIE", { refreshTo: "fresh" });
    const response = await refreshSession(page("/help"), fake);
    expect(fake.readUserId).toHaveBeenCalledOnce();
    expect(response.cookies.get("sb-ref-auth-token")?.value).toBe("fresh");
  });

  it("never redirects a server action, so it can answer session-expired and the form survives", async () => {
    const action = page("/jobs/new", { method: "POST", headers: { "next-action": "abc123" } });
    const response = await refreshSession(action, sources(null));
    expect(response.headers.get("location")).toBeNull();
  });

  it("never redirects other writes either (route handlers answer 401/403 themselves)", async () => {
    const response = await refreshSession(page("/admin/payouts", { method: "POST" }), sources(null));
    expect(response.headers.get("location")).toBeNull();
  });

  it("passes refreshed cookies to the page and to the browser", async () => {
    const response = await refreshSession(page("/dashboard"), sources("CUSTOMER", { refreshTo: "new-tokens" }));
    expect(response.cookies.get("sb-ref-auth-token")).toMatchObject({ value: "new-tokens", httpOnly: true });
    // The page rendering after the proxy reads the request's cookies, which Next.js forwards in this header.
    expect(response.headers.get("x-middleware-request-cookie")).toContain("sb-ref-auth-token=new-tokens");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("keeps refreshed cookies on a redirect too, so the new refresh token isn't lost", async () => {
    const response = await refreshSession(page("/admin"), sources("TRADIE", { refreshTo: "new-tokens" }));
    expect(response.headers.get("location")).toBe(`${SITE}/jobs`);
    expect(response.cookies.get("sb-ref-auth-token")?.value).toBe("new-tokens");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("treats a session with no profile as signed out", async () => {
    const fake = { readUserId: async () => "user-1", findRole: async () => null };
    const response = await refreshSession(page("/messages"), fake);
    expect(response.headers.get("location")).toBe(`${SITE}/login?next=%2Fmessages`);
  });
});

describe("refreshSession with Supabase not set up", () => {
  it("runs everyone as signed out, without any network call", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect((await refreshSession(page("/"))).headers.get("location")).toBeNull();
    expect((await refreshSession(page("/dashboard"))).headers.get("location")).toBe(`${SITE}/login?next=%2Fdashboard`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// The real @supabase/ssr client, with Supabase Auth faked at the fetch level.
describe("refreshSession with the real Supabase client", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const jwt = (exp: number) =>
    `${base64url({ alg: "HS256", typ: "JWT" })}.${base64url({ sub: userId, exp, role: "authenticated" })}.sig`;
  const authUser = { id: userId, aud: "authenticated", email: "sam@example.nz", app_metadata: {}, user_metadata: {} };

  function sessionCookie(accessToken: string, expiresAt: number) {
    const session = {
      access_token: accessToken,
      refresh_token: "old-refresh",
      expires_at: expiresAt,
      expires_in: 3600,
      token_type: "bearer",
      user: authUser,
    };
    return `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  }

  it("swaps an expired access token for a new one and sets it as an http-only, secure, same-site cookie", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("NODE_ENV", "production");
    const now = Math.floor(Date.now() / 1000);
    const fresh = jwt(now + 3600);
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        calls.push(url.replace("https://ref.supabase.co", ""));
        if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
          return Response.json({
            access_token: fresh,
            refresh_token: "new-refresh",
            expires_in: 3600,
            expires_at: now + 3600,
            token_type: "bearer",
            user: authUser,
          });
        }
        if (url.endsWith("/auth/v1/user")) return Response.json(authUser);
        return new Response("unexpected", { status: 500 });
      }),
    );

    const request = page("/dashboard", {
      headers: { cookie: `sb-ref-auth-token=${sessionCookie(jwt(now - 60), now - 60)}` },
    });
    const response = await refreshSession(request, {
      readUserId: defaultRefreshSources.readUserId,
      findRole: async (id) => (id === userId ? "CUSTOMER" : null),
    });

    expect(calls).toContain("/auth/v1/token?grant_type=refresh_token");
    expect(response.headers.get("location")).toBeNull();
    const cookie = response.cookies.get("sb-ref-auth-token");
    expect(cookie?.value).toContain("base64-");
    expect(Buffer.from(cookie!.value.slice(7), "base64url").toString()).toContain("new-refresh");
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  });

  it("treats a forged session cookie as signed out", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    // Supabase Auth refuses the token, as it would one that wasn't signed with the project's key.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ code: 403, error_code: "bad_jwt", msg: "invalid JWT" }, { status: 403 })),
    );
    const now = Math.floor(Date.now() / 1000);
    const findRole = vi.fn(async () => "ADMIN" as const);
    const request = page("/admin", {
      headers: { cookie: `sb-ref-auth-token=${sessionCookie(jwt(now + 3600), now + 3600)}` },
    });

    const response = await refreshSession(request, {
      readUserId: defaultRefreshSources.readUserId,
      findRole,
    });

    expect(response.headers.get("location")).toBe(`${SITE}/login?next=%2Fadmin`);
    expect(findRole).not.toHaveBeenCalled();
  });
});

describe("proxy matcher", () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);

  it("runs on pages and server actions", () => {
    for (const path of ["/", "/dashboard", "/jobs/abc", "/admin/settings", "/login"]) {
      expect(matcher.test(path), path).toBe(true);
    }
  });

  it("skips Next.js's own files and static files", () => {
    for (const path of ["/_next/static/chunk.js", "/_next/image", "/favicon.ico", "/fonts/roboto-flex/x.woff2"]) {
      expect(matcher.test(path), path).toBe(false);
    }
  });
});
