// Local-only provider double for real server-action journeys. The optional signup fixture writes only its
// dedicated disposable localhost database; the default #113 fixtures never access a database.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import pg from "pg";

import { mintAccessToken, verifyAccessToken } from "../../../scripts/screenshots/auth-stub";

export const SECURITY_USER = { id: "11111111-1111-4111-8111-111111111113", email: "security-customer@example.test" };
export const SECURITY_TRADIE = { id: "22222222-2222-4222-8222-222222222113", email: "security-tradie@example.test" };
export const SECURITY_PASSWORD = "demo-current-password";

export type SecurityAuthStubOptions = { signup?: { databaseUrl: string } };
type FixtureUser = { id: string; email: string; password: string; new_email: string; challenge: string; code: string;
  registered?: boolean; confirmed?: boolean; metadata?: Record<string, unknown>; confirmationHash?: string; redirectTo?: string };
const loopback = (url: URL) => ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);

export async function startSecurityAuthStub(port: number, options: SecurityAuthStubOptions = {}) {
  let registrationDb: pg.Pool | undefined;
  if (options.signup) {
    let database: URL;
    try { database = new URL(options.signup.databaseUrl); }
    catch { throw new Error("Signup fixture requires a dedicated localhost issue120 or issue121 database"); }
    // pg accepts host overrides in query parameters; rejecting them keeps the parsed loopback guard binding.
    if (!loopback(database) || !["postgres:", "postgresql:"].includes(database.protocol) || !["/issue120", "/issue121"].includes(database.pathname) || database.search || database.hash) {
      throw new Error("Signup fixture requires a dedicated localhost issue120 or issue121 database");
    }
    registrationDb = new pg.Pool({ connectionString: options.signup.databaseUrl, max: 1 });
  }
  const secret = randomBytes(32).toString("hex");
  const users = new Map<string, FixtureUser>([SECURITY_USER, SECURITY_TRADIE].map(user => [user.id, { ...user, password: SECURITY_PASSWORD, new_email: "", challenge: "", code: "" }]));
  const sessions = new Map<string, string>();
  const verificationTokens = new Map<string, string>();
  const events: Array<{ method: string; path: string; userId: string; scope?: string }> = [];
  let failLogout = false;
  let requireRecentLogin = false;
  const userJson = (id: string) => {
    const user = users.get(id)!;
    return { id, email: user.email, new_email: user.new_email, aud: "authenticated", role: "authenticated", email_confirmed_at: user.registered && !user.confirmed ? null : "2026-01-01T00:00:00Z", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: user.metadata ?? {}, identities: user.registered ? [{ id, user_id: id, provider: "email", identity_data: { sub: id, email: user.email } }] : [], created_at: "2026-01-01T00:00:00Z" };
  };
  const issueConfirmation = (user: FixtureUser, redirectTo?: string) => {
    if (user.confirmationHash) verificationTokens.delete(user.confirmationHash);
    user.confirmationHash = randomBytes(32).toString("hex"); user.redirectTo = redirectTo ?? user.redirectTo;
    verificationTokens.set(user.confirmationHash, user.id);
  };
  const registeredUser = (email: string) => [...users.values()].find(user => user.registered && user.email === email.trim().toLowerCase());
  const signupConfirmation = (email: string) => {
    const user = registeredUser(email);
    if (!user?.confirmationHash || !verificationTokens.has(user.confirmationHash)) throw new Error("No pending local confirmation for this fixture account");
    return { userId: user.id, tokenHash: user.confirmationHash, redirectTo: user.redirectTo ?? "" };
  };
  const sessionJson = (id: string) => {
    const token = mintAccessToken(users.get(id)!, secret);
    sessions.set(token, id);
    return { access_token: token, refresh_token: token, token_type: "bearer", expires_in: 3600, user: userJson(id) };
  };
  const server = createServer(async (request, response) => {
    const send = (status: number, body: unknown) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)); };
    try {
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      let raw = ""; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw || "{}");
      const token = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
      const verified = verifyAccessToken(token, secret);
      const id = verified?.id;
      events.push({ method: request.method!, path: url.pathname, userId: id ?? "", scope: url.searchParams.get("scope") ?? undefined });
      if (registrationDb && request.method === "POST" && url.pathname === "/auth/v1/signup") {
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        if (!email || email.length > 254 || typeof body.password !== "string" || !body.password) return send(400, { error_code: "validation_failed", msg: "Invalid signup fixture input" });
        if ([...users.values()].some(user => user.email === email)) return send(400, { error_code: "user_already_exists", msg: "User already registered" });
        const user: FixtureUser = { id: randomUUID(), email, password: body.password, new_email: "", challenge: "", code: "", registered: true, confirmed: false, metadata: body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {} };
        // The real application's ensureProfile runs only after this response. Its auth.users FK is already valid.
        await registrationDb.query("INSERT INTO auth.users (id,email) VALUES ($1,$2)", [user.id, user.email]);
        users.set(user.id, user); issueConfirmation(user, url.searchParams.get("redirect_to") ?? undefined);
        return send(200, { user: userJson(user.id), session: null });
      }
      if (registrationDb && request.method === "POST" && url.pathname === "/auth/v1/otp") {
        const user = typeof body.email === "string" ? registeredUser(body.email) : undefined;
        if (!user) return send(400, { error_code: "user_not_found", msg: "Unknown fixture account" });
        issueConfirmation(user, url.searchParams.get("redirect_to") ?? undefined); return send(200, {});
      }
      if (registrationDb && request.method === "POST" && url.pathname === "/auth/v1/verify") {
        const userId = body.type === "email" && typeof body.token_hash === "string" ? verificationTokens.get(body.token_hash) : undefined;
        const user = userId ? users.get(userId) : undefined;
        if (!user) return send(400, { error_code: "otp_expired", msg: "Invalid or used fixture confirmation" });
        verificationTokens.delete(body.token_hash); user.confirmationHash = ""; user.confirmed = true;
        return send(200, sessionJson(user.id));
      }
      if (url.pathname === "/auth/v1/token") {
        if (url.searchParams.get("grant_type") === "password") {
          const user = [...users.values()].find(user => user.email === body.email && user.password === body.password);
          if (user?.registered && !user.confirmed) return send(400, { error_code: "email_not_confirmed", msg: "Email not confirmed" });
          return user ? send(200, sessionJson(user.id)) : send(400, { error_code: "invalid_credentials", msg: "Invalid credentials" });
        }
        if (url.searchParams.get("grant_type") === "pkce") {
          const user = [...users.values()].find(user => user.code && user.code === body.auth_code);
          if (!user || createHash("sha256").update(body.code_verifier ?? "").digest("base64url") !== user.challenge) return send(400, { error_code: "flow_state_not_found", msg: "Invalid code" });
          user.email = user.new_email; user.new_email = ""; user.code = "";
          return send(200, sessionJson(user.id));
        }
        const sessionId = sessions.get(body.refresh_token);
        return sessionId ? send(200, sessionJson(sessionId)) : send(400, { error_code: "refresh_token_not_found", msg: "Revoked session" });
      }
      if (!id || !users.has(id) || users.get(id)?.registered && !sessions.has(token)) return send(401, { error_code: "bad_jwt", msg: "Invalid token" });
      if (url.pathname === "/auth/v1/logout") {
        const scope = url.searchParams.get("scope");
        if (failLogout && scope === "others") return send(500, { error_code: "unexpected_failure", msg: "Temporary failure" });
        for (const [key, userId] of sessions) if (userId === id && (scope === "others" ? key !== token : key === token)) sessions.delete(key);
        return send(200, {});
      }
      if (url.pathname === "/auth/v1/user") {
        const user = users.get(id)!;
        if (request.method === "PUT") {
          if (body.password) {
            if (requireRecentLogin) return send(400, { error_code: "reauthentication_needed", msg: "Please log in again" });
            if (body.current_password !== user.password) return send(400, { error_code: "invalid_current_password", msg: "Wrong current password" });
            user.password = body.password;
          }
          if (body.email) { user.new_email = body.email; user.challenge = body.code_challenge; user.code = randomBytes(12).toString("hex"); }
        }
        return send(200, userJson(id));
      }
      return send(404, { msg: "Not part of this isolated provider" });
    } catch { return send(500, { msg: "Test provider error" }); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return {
    events,
    signupConfirmation,
    registeredUser: (email: string) => { const user = registeredUser(email); return user ? { id: user.id, email: user.email, confirmed: user.confirmed === true } : undefined; },
    confirmationUrl: (email: string, appOrigin: string, next?: string) => {
      const origin = new URL(appOrigin);
      if (!loopback(origin) || origin.protocol !== "http:") throw new Error("Fixture confirmation must use a localhost app origin");
      const confirmation = signupConfirmation(email);
      const destination = new URL("/verify/confirm", origin);
      const returnTo = next ?? new URL(confirmation.redirectTo || "/verify/confirm", origin).searchParams.get("next");
      if (returnTo) destination.searchParams.set("next", returnTo);
      destination.searchParams.set("token_hash", confirmation.tokenHash); destination.searchParams.set("type", "email");
      return destination.href;
    },
    setLogoutFailure: (value: boolean) => { failLogout = value; },
    requireRecentLogin: (value: boolean) => { requireRecentLogin = value; },
    confirmationCode: () => users.get(SECURITY_USER.id)!.code,
    password: () => users.get(SECURITY_USER.id)!.password,
    reset: () => { failLogout = false; requireRecentLogin = false; events.length = 0; sessions.clear(); verificationTokens.clear(); users.clear(); for (const original of [SECURITY_USER, SECURITY_TRADIE]) users.set(original.id, { ...original, password: SECURITY_PASSWORD, new_email: "", challenge: "", code: "" }); },
    close: async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await registrationDb?.end(); },
  };
}
