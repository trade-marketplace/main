// Local-only provider double for #113's real server-action journey. No Supabase service or database is used.
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

import { mintAccessToken, verifyAccessToken } from "../../../scripts/screenshots/auth-stub";

export const SECURITY_USER = { id: "11111111-1111-4111-8111-111111111113", email: "security-customer@example.test" };
export const SECURITY_TRADIE = { id: "22222222-2222-4222-8222-222222222113", email: "security-tradie@example.test" };
export const SECURITY_PASSWORD = "demo-current-password";

export async function startSecurityAuthStub(port: number) {
  const secret = randomBytes(32).toString("hex");
  const users = new Map([SECURITY_USER, SECURITY_TRADIE].map(user => [user.id, { ...user, password: SECURITY_PASSWORD, new_email: "", challenge: "", code: "" }]));
  const sessions = new Map<string, string>();
  const events: Array<{ method: string; path: string; userId: string; scope?: string }> = [];
  let failLogout = false;
  const userJson = (id: string) => {
    const user = users.get(id)!;
    return { id, email: user.email, new_email: user.new_email, aud: "authenticated", role: "authenticated", email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [], created_at: "2026-01-01T00:00:00Z" };
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
      if (url.pathname === "/auth/v1/token") {
        if (url.searchParams.get("grant_type") === "password") {
          const user = [...users.values()].find(user => user.email === body.email && user.password === body.password);
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
      if (!id) return send(401, { error_code: "bad_jwt", msg: "Invalid token" });
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
    setLogoutFailure: (value: boolean) => { failLogout = value; },
    confirmationCode: () => users.get(SECURITY_USER.id)!.code,
    password: () => users.get(SECURITY_USER.id)!.password,
    reset: () => { failLogout = false; events.length = 0; sessions.clear(); for (const original of [SECURITY_USER, SECURITY_TRADIE]) users.set(original.id, { ...original, password: SECURITY_PASSWORD, new_email: "", challenge: "", code: "" }); },
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
