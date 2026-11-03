import "server-only";
import { z } from "zod";
import { createPrivateKey } from "node:crypto";
import { firebaseWebSchema } from "@/lib/browser-push";

const account = z.object({ project_id: z.string(), client_email: z.email(), private_key: z.string().min(100).max(20_000) });
export function firebaseCredentials(env: Record<string, string | undefined> = process.env) {
  try {
    const parsed = account.safeParse(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON ?? "null"));
    return parsed.success && createPrivateKey(parsed.data.private_key).asymmetricKeyType === "rsa" ? parsed.data : null;
  } catch { return null; }
}
/** Only the explicitly public web fields leave this module. Private credentials never enter browser props. */
export function firebaseWebConfig(env: Record<string, string | undefined> = process.env) {
  const parsed = firebaseWebSchema.safeParse({ apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.NEXT_PUBLIC_FIREBASE_APP_ID, vapidKey: env.NEXT_PUBLIC_FIREBASE_VAPID_KEY });
  const credentials = firebaseCredentials(env);
  return parsed.success && credentials?.project_id === parsed.data.projectId ? parsed.data : null;
}
