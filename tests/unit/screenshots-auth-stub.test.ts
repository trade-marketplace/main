import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { createServerClient } from "@supabase/ssr";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  mintAccessToken,
  sessionChecks,
  sessionCookies,
  startAuthStub,
  STUB_PUBLISHABLE_KEY,
  verifyAccessToken,
} from "../../scripts/screenshots/auth-stub";

const secret = "test-secret-not-real";
const user = { id: "de000000-0000-4000-8000-000000000002", email: "tradie@demo.test" };

describe("stub access tokens", () => {
  it("verifies a token it made", () => {
    expect(verifyAccessToken(mintAccessToken(user, secret), secret)).toEqual(user);
  });

  it("refuses a forged, edited or expired token", () => {
    const token = mintAccessToken(user, secret);
    expect(verifyAccessToken(mintAccessToken(user, "another-secret"), secret)).toBeNull();
    const [header, , signature] = token.split(".");
    const edited = Buffer.from(JSON.stringify({ sub: "someone-else", exp: 9_999_999_999 })).toString("base64url");
    expect(verifyAccessToken(`${header}.${edited}.${signature}`, secret)).toBeNull();
    expect(verifyAccessToken(token, secret, Date.now() + 2 * 3600 * 1000)).toBeNull();
    expect(verifyAccessToken("not-a-jwt", secret)).toBeNull();
  });
});

describe("stub Supabase Auth server", () => {
  let server: Server;
  let stubUrl: string;

  beforeAll(async () => {
    server = await startAuthStub(secret, 0);
    stubUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("answers /auth/v1/user for a good token and 401 for a bad one", async () => {
    const good = await fetch(`${stubUrl}/auth/v1/user`, {
      headers: { authorization: `Bearer ${mintAccessToken(user, secret)}` },
    });
    expect(good.status).toBe(200);
    expect(await good.json()).toMatchObject({ id: user.id, email: user.email, aud: "authenticated" });
    const bad = await fetch(`${stubUrl}/auth/v1/user`, { headers: { authorization: "Bearer nope" } });
    expect(bad.status).toBe(401);
    expect((await fetch(`${stubUrl}/rest/v1/profiles`)).status).toBe(404);
  });

  it("makes session cookies that the app's own Supabase client reads back as the signed-in user", async () => {
    const cookies = await sessionCookies(user, secret, "http://127.0.0.1:3100", stubUrl);
    expect(cookies.map((cookie) => cookie.name)).toEqual(["sb-127-auth-token"]);
    expect(cookies[0]).toMatchObject({ httpOnly: true, url: "http://127.0.0.1:3100" });

    // What src/server/auth/refresh.ts and viewer.ts do on every request.
    const before = await sessionChecks(user.id, stubUrl);
    const app = createServerClient(stubUrl, STUB_PUBLISHABLE_KEY, {
      cookies: { getAll: () => cookies.map(({ name, value }) => ({ name, value })), setAll: () => {} },
    });
    const { data, error } = await app.auth.getClaims();
    expect(error).toBeNull();
    expect(data?.claims.sub).toBe(user.id);
    expect(await sessionChecks(user.id, stubUrl)).toBe(before + 1);
  });

  it("refreshes a session with its refresh token", async () => {
    const response = await fetch(`${stubUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      body: JSON.stringify({ refresh_token: mintAccessToken(user, secret) }),
    });
    expect(response.status).toBe(200);
    expect(verifyAccessToken((await response.json()).access_token, secret)).toEqual(user);
    const refused = await fetch(`${stubUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      body: JSON.stringify({ refresh_token: "forged" }),
    });
    expect(refused.status).toBe(400);
  });
});
