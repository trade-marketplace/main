import { generateKeyPairSync } from "node:crypto";
import { JWT } from "google-auth-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { firebaseCredentials, firebaseWebConfig } from "@/server/notifications/push-config";
import { firebasePushSender } from "@/server/notifications/firebase-provider";
import { displayPriceReady } from "@/lib/push-display";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const config = { NEXT_PUBLIC_FIREBASE_API_KEY: "public-test-value", NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "trade-test.firebaseapp.com", NEXT_PUBLIC_FIREBASE_PROJECT_ID: "trade-test", NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "12345678", NEXT_PUBLIC_FIREBASE_APP_ID: "1:12345678:web:example", NEXT_PUBLIC_FIREBASE_VAPID_KEY: "B".repeat(87), FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: "trade-test", client_email: "test@trade-test.iam.gserviceaccount.com", private_key: privateKey }) };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("configured Firebase data-only transport", () => {
  it("keeps missing, malformed or mismatched credentials unavailable and returns only public fields", () => {
    expect(firebaseWebConfig({})).toBeNull(); expect(firebaseCredentials({ FIREBASE_SERVICE_ACCOUNT_JSON: "bad" })).toBeNull();
    expect(firebaseWebConfig({ ...config, FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: "wrong-project", client_email: "test@example.test", private_key: privateKey }) })).toBeNull();
    expect(firebaseWebConfig({ ...config, FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: "trade-test", client_email: "test@example.test", private_key: "bad".repeat(100) }) })).toBeNull();
    const web = firebaseWebConfig(config); expect(web?.projectId).toBe("trade-test");
    expect(JSON.stringify(web)).not.toContain("PRIVATE KEY"); expect(JSON.stringify(web)).not.toContain("client_email");
  });
  it("sends only an opaque delivery id, never auto-display notification content or private job details", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ name: "projects/trade-test/messages/accepted" }));
    const sender = firebasePushSender(config, fetcher, async () => "test-oauth-value")!;
    expect(await sender("test-device-token", "opaque-delivery")).toMatchObject({ accepted: true });
    const [url, request] = fetcher.mock.calls[0]; expect(url).toBe("https://fcm.googleapis.com/v1/projects/trade-test/messages:send");
    expect(new Headers(request?.headers).get("authorization")).toBe("Bearer test-oauth-value");
    const body = JSON.parse(request!.body as string); expect(body.message.data).toEqual({ deliveryId: "opaque-delivery" });
    expect(body.message.notification).toBeUndefined(); expect(body.message.webpush.notification).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("customerPrice");
  });
  it("does not claim an HTTP refusal/invalid token/malformed acceptance was delivered", async () => {
    const sender = (response: Response) => firebasePushSender(config, async () => response, async () => "test-oauth-value")!;
    expect(await sender(Response.json({ error: { details: [{ errorCode: "UNREGISTERED" }] } }, { status: 404 }))("test-token", "opaque")).toMatchObject({ accepted: false, invalidToken: true });
    expect(await sender(Response.json({}))("test-token", "opaque")).toMatchObject({ accepted: false });
    expect(firebasePushSender({})).toBeNull();
  });
  it.each(["503", "connection"])("disables retries in the real official OAuth pipeline after %s failure", async failure => {
    const oauth = vi.fn(async () => {
      if (failure === "connection") throw new Error("Connection lost");
      return new Response(JSON.stringify({ error: "temporarily_unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
    });
    const original = JWT.prototype.getAccessToken;
    vi.spyOn(JWT.prototype, "getAccessToken").mockImplementation(function (this: JWT, ...args: Parameters<typeof original>) {
      this.transporter.defaults.fetchImplementation = oauth;
      return original.apply(this, args);
    });
    const fcm = vi.fn<typeof fetch>();
    await expect(firebasePushSender(config, fcm)!("device-token", "opaque")).rejects.toThrow();
    expect(oauth).toHaveBeenCalledTimes(1); expect(fcm).not.toHaveBeenCalled();
  });
});
describe("foreground/background display protocol", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("displays only a successful fresh owned claim and ignores a duplicate even after dismissal", async () => {
    vi.stubGlobal("location", { origin: "https://trademarketplace.nz" });
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ title: "Price ready", body: "TM-1042", href: `/jobs/${id}`, tag: `trade-price:${id}` })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher); const showNotification = vi.fn(async () => {});
    await displayPriceReady({ showNotification }, id); await displayPriceReady({ showNotification }, id);
    expect(showNotification).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledWith(`/api/notifications/push/${id}/display`, expect.objectContaining({ method: "POST", credentials: "same-origin" }));
  });
  it("rejects cross-origin or unrelated navigation and refuses an unauthenticated response", async () => {
    vi.stubGlobal("location", { origin: "https://trademarketplace.nz" });
    const showNotification = vi.fn(async () => {});
    for (const href of [`https://example.test/jobs/${id}`, "/admin", `/jobs/${id}?posted=1`]) {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ title: "Price ready", body: "TM-1042", href, tag: "tag" })));
      await displayPriceReady({ showNotification }, id);
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 }))); await displayPriceReady({ showNotification }, id);
    expect(showNotification).not.toHaveBeenCalled();
  });
});
