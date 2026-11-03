import { z } from "zod";
import { POST_KEY_SCHEMA } from "@/lib/job-draft";
import { withRoleRoute } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { UploadError, MESSAGES } from "@/server/files/errors";
import { createSupabaseFileStore } from "@/server/files/storage";
import { beginDraftPhoto, cancelDraftPhoto, finalizeDraftPhoto, getPhotoStaging } from "@/server/jobs/photo-upload";

const inputSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("begin"), ownerId: z.uuid(), postKey: POST_KEY_SCHEMA, size: z.number().int().positive().max(10 * 1024 * 1024) }).strict(),
  z.object({ operation: z.literal("finalize"), ownerId: z.uuid(), postKey: POST_KEY_SCHEMA, path: z.string().max(250) }).strict(),
  z.object({ operation: z.literal("cancel"), ownerId: z.uuid(), postKey: POST_KEY_SCHEMA, path: z.string().max(250) }).strict(),
]);
export const POST = withRoleRoute(["CUSTOMER"], async (viewer, request) => {
  if (Number(request.headers.get("content-length")) > 4096) return Response.json({ error: "invalid" }, { status: 413 });
  try {
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "invalid", message: MESSAGES.photoType }, { status: 400 });
    const input = parsed.data;
    if (input.ownerId !== viewer.userId) return Response.json({ error: "forbidden" }, { status: 403 });
    if (input.operation === "cancel") { await cancelDraftPhoto(getDb(), viewer, input.path); return Response.json({ ok: true }); }
    const staging = getPhotoStaging();
    if (input.operation === "begin") {
      const result = await beginDraftPhoto(getDb(), staging, viewer, input.postKey, input.size);
      return Response.json(result, { status: result.status === "ready" ? 200 : 429, headers: { "Cache-Control": "private, no-store" } });
    }
    return Response.json(await finalizeDraftPhoto(getDb(), staging, createSupabaseFileStore(), viewer, input.postKey, input.path), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof UploadError) return Response.json({ error: error.code, message: error.message }, { status: error.code === "not-allowed" ? 403 : error.code === "too-large" ? 413 : 400 });
    return Response.json({ error: "unavailable", message: MESSAGES.storageFailed }, { status: 503 });
  }
});
