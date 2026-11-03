import { z } from "zod";

export const firebaseWebSchema = z.object({
  apiKey: z.string().min(10).max(256), authDomain: z.string().min(1).max(253),
  projectId: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/),
  messagingSenderId: z.string().regex(/^\d+$/), appId: z.string().min(1).max(200),
  vapidKey: z.string().min(60).max(200).regex(/^[\w-]+$/),
}).strict();
export type FirebaseWebConfig = z.infer<typeof firebaseWebSchema>;
export const PUSH_WORKER_PATH = "/firebase-messaging-sw.js";
export const PUSH_ENABLED_EVENT = "trade:push-enabled";
export type PushCardState = "loading" | "ready" | "requesting" | "enabled" | "denied" | "unsupported" | "unavailable" | "error";
export type BrowserPushStatus = "active" | "revoked" | "inactive" | "opted-out" | "unavailable";
/** A previous explicit opt-in can reconnect without asking native permission again. Explicit dismissals win. */
export function shouldOfferBrowserPush({ asked, dismissed, consented, permission, status }: {
  asked: boolean; dismissed: boolean; consented: boolean; permission: NotificationPermission; status: BrowserPushStatus;
}) {
  if (dismissed || status === "active" || status === "opted-out" || status === "unavailable") return false;
  return !asked || permission === "granted" && (consented || status === "revoked");
}
export const PUSH_NOTICE = { unavailable: "Browser notifications aren’t available.", denied: "Browser notifications are blocked.", error: "Couldn’t turn on notifications." } as const;
