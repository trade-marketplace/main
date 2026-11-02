import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/** True when the request's `Authorization: Bearer <secret>` is the configured secret. Compared in constant time. */
export function isSchedulerRequest(authorization: string | null, secret: string): boolean {
  const match = /^Bearer (.+)$/.exec(authorization ?? "");
  if (!match) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(match[1]), digest(secret));
}
