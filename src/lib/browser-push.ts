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
export const PUSH_NOTICE = { unavailable: "Browser notifications aren’t available.", denied: "Browser notifications are blocked.", error: "Couldn’t turn on notifications." } as const;
