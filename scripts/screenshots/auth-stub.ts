// A stand-in for Supabase Auth, for the screenshot run only (#90). CI has no Supabase project (and must never use
// the real one), so the app is built with NEXT_PUBLIC_SUPABASE_URL pointing here and signs people in through its
// normal code: `getClaims()` sees an HS256 token, asks this server's `/auth/v1/user` who it belongs to, and the
// role then comes from the seeded `profiles` row as usual. Nothing in the app knows it's a stub.
//
// Tokens are signed with a random secret made for each run, so they're worthless outside it.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";

import { createServerClient } from "@supabase/ssr";

export const STUB_PORT = 54321;
export const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;
/** Any non-empty value works: the stub doesn't check it. Not a real key. */
export const STUB_PUBLISHABLE_KEY = "sb_publishable_screenshots_stub";

export type StubUser = { id: string; email: string };

function base64url(data: string | Buffer): string {
  return Buffer.from(data).toString("base64url");
}

function sign(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

/** An access token for `user`, valid for an hour. */
export function mintAccessToken(user: StubUser, secret: string, now = Date.now()): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const issued = Math.floor(now / 1000);
  const payload = base64url(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      aud: "authenticated",
      role: "authenticated",
      iat: issued,
      exp: issued + 3600,
      session_id: randomBytes(8).toString("hex"),
    }),
  );
  return `${header}.${payload}.${sign(`${header}.${payload}`, secret)}`;
}

/** The user a token belongs to, or null when it's forged, edited or expired. */
export function verifyAccessToken(token: string, secret: string, now = Date.now()): StubUser | null {
  const [header, payload, signature, extra] = token.split(".");
  if (!header || !payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(`${header}.${payload}`, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof claims.sub !== "string" || typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
    return { id: claims.sub, email: String(claims.email ?? "") };
  } catch {
    return null;
  }
}

function userJson(user: StubUser) {
  return {
    id: user.id,
    aud: "authenticated",
    role: "authenticated",
    email: user.email,
    email_confirmed_at: "2026-01-01T00:00:00Z",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

/**
 * Answers the one call the app makes (`GET /auth/v1/user`) and refreshes (`POST /auth/v1/token`, in case a run
 * takes over an hour). `GET /__stub/checks?user=<id>` says how many times the app has checked that user's session,
 * so the capture can prove a sign-in took. Everything else is a 404.
 */
export function startAuthStub(secret: string, port = STUB_PORT): Promise<Server> {
  const checks = new Map<string, number>();
  const server = createServer((request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    const url = new URL(request.url ?? "/", STUB_URL);
    if (request.method === "GET" && url.pathname === "/auth/v1/user") {
      const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1] ?? "";
      const user = verifyAccessToken(token, secret);
      if (user) checks.set(user.id, (checks.get(user.id) ?? 0) + 1);
      return user
        ? send(200, userJson(user))
        : send(401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
    }
    if (request.method === "POST" && url.pathname === "/auth/v1/token") {
      let raw = "";
      request.on("data", (chunk) => (raw += chunk));
      request.on("end", () => {
        const refresh = String(JSON.parse(raw || "{}").refresh_token ?? "");
        const user = verifyAccessToken(refresh, secret, 0);
        if (!user) return send(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
        send(200, sessionJson(user, secret));
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/__stub/checks") {
      return send(200, { checks: checks.get(url.searchParams.get("user") ?? "") ?? 0 });
    }
    send(404, { code: 404, msg: "not part of the screenshot auth stub" });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function sessionJson(user: StubUser, secret: string) {
  const accessToken = mintAccessToken(user, secret);
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    // The refresh token is just another signed token; the stub accepts it even after it expires.
    refresh_token: accessToken,
    user: userJson(user),
  };
}

/** How many times the app has checked `userId`'s session so far. */
export async function sessionChecks(userId: string, stubUrl = STUB_URL): Promise<number> {
  const response = await fetch(`${stubUrl}/__stub/checks?user=${encodeURIComponent(userId)}`);
  return ((await response.json()) as { checks: number }).checks;
}

export type BrowserCookie = { name: string; value: string; url: string; httpOnly: boolean; sameSite: "Lax" };

/**
 * The session cookies a browser would hold after logging in as `user`. Made by @supabase/ssr itself (the same
 * library the app reads them with), so the cookie name, encoding and chunking always match.
 */
export async function sessionCookies(
  user: StubUser,
  secret: string,
  appUrl: string,
  stubUrl = STUB_URL,
): Promise<BrowserCookie[]> {
  const jar = new Map<string, string>();
  const supabase = createServerClient(stubUrl, STUB_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  const session = sessionJson(user, secret);
  const { error } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error) throw new Error(`Couldn't make a session for ${user.email}: ${error.message}`);
  return [...jar].map(([name, value]) => ({ name, value, url: appUrl, httpOnly: true, sameSite: "Lax" }));
}
