import "server-only";
import { JWT } from "google-auth-library";
import { firebaseCredentials, firebaseWebConfig } from "./push-config";

export type PushSendResult = { accepted: boolean; invalidToken?: boolean };
export type PushSender = (token: string, deliveryId: string) => Promise<PushSendResult>;

/** Official Google OAuth credentials, then the FCM HTTPv1 data-only API. No private data enters the push body. */
export function firebasePushSender(env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch, accessToken?: () => Promise<string>): PushSender | null {
  const credentials = firebaseCredentials(env), web = firebaseWebConfig(env);
  if (!credentials || !web) return null;
  const client = accessToken ? null : new JWT({ email: credentials.client_email, key: credentials.private_key,
    // gtoken adds a POST retryConfig, so retry:false alone does not disable Gaxios retries.
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"], transporterOptions: { timeout: 4_000, retry: false, retryConfig: { retry: 0, noResponseRetries: 0 } } });
  return async (token, deliveryId) => {
    const deadline = Date.now() + 8_000;
    const bearer = accessToken ? await accessToken() : (await client!.getAccessToken()).token;
    if (!bearer || Date.now() >= deadline) return { accepted: false };
    const response = await fetcher(`https://fcm.googleapis.com/v1/projects/${web.projectId}/messages:send`, {
      method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { token, data: { deliveryId }, webpush: { headers: { TTL: "86400" } } } }),
      signal: AbortSignal.timeout(Math.max(1, Math.min(4_000, deadline - Date.now()))),
    });
    const body = await response.json().catch(() => null);
    return { accepted: response.ok && typeof body?.name === "string" && body.name.startsWith(`projects/${web.projectId}/messages/`),
      invalidToken: !response.ok && Array.isArray(body?.error?.details) && body.error.details.some((detail: { errorCode?: unknown }) => detail.errorCode === "UNREGISTERED" || detail.errorCode === "SENDER_ID_MISMATCH") };
  };
}
