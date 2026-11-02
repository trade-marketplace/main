import "server-only";

import { tryAgainText } from "@/lib/rate-limit";
import { MESSAGES, UploadError } from "@/server/files/errors";
import { MAX_UPLOAD_BYTES } from "@/server/files/images";
import type { RateLimitDecision } from "@/server/rate-limit";

import type { createAvatarService } from "./avatar";

export type AvatarRouteDeps = {
  /** A function, so a Storage that isn't set up is an answer ("unavailable"), not a crash. */
  service: () => ReturnType<typeof createAvatarService>;
  limit: (name: "upload", userId: string) => Promise<RateLimitDecision>;
};

export type AvatarResponse = { ok: true; url: string } | { ok: false; error: string; message: string };

const fail = (status: number, error: string, message: string) => Response.json({ ok: false, error, message } satisfies AvatarResponse, { status });

/**
 * The body of POST /api/profile/avatar: one image in the `photo` field. The person is the checked session's
 * (`userId`), never anything in the request. Answers with a link to the new photo, or a plain sentence to show.
 */
export async function avatarRoute(userId: string, request: Request, deps: AvatarRouteDeps): Promise<Response> {
  const limit = await deps.limit("upload", userId);
  if (!limit.allowed) return fail(429, "try-later", `Too many tries. ${tryAgainText(limit.retryAfter)}`);
  let file: unknown;
  try {
    file = (await request.formData()).get("photo");
  } catch {
    return fail(400, "invalid", MESSAGES.unreadable);
  }
  if (!(file instanceof File)) return fail(400, "invalid", MESSAGES.unreadable);
  if (file.size > MAX_UPLOAD_BYTES) return fail(413, "too-large", MESSAGES.tooLarge);
  try {
    const { url } = await deps.service().setAvatar(userId, new Uint8Array(await file.arrayBuffer()));
    return Response.json({ ok: true, url } satisfies AvatarResponse);
  } catch (error) {
    if (error instanceof UploadError) {
      const status = error.code === "storage-failed" ? 503 : error.code === "too-large" ? 413 : 400;
      return fail(status, error.code, error.message);
    }
    return fail(503, "unavailable", MESSAGES.storageFailed);
  }
}
