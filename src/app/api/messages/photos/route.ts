import { z } from "zod";
import { withRoleRoute } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { createSupabaseFileStore } from "@/server/files/storage";
import { MAX_UPLOAD_BYTES } from "@/server/files/images";
import { uploadSupportPhoto } from "@/server/messages/photos";
import { consumeForUser } from "@/server/rate-limit";

export const POST = withRoleRoute(["CUSTOMER", "TRADIE"], async (viewer, request) => {
  if (Number(request.headers.get("content-length")) > 4.25 * 1024 * 1024) return Response.json({ error: "too-large" }, { status: 413 });
  const rate = await consumeForUser("upload", viewer.userId);
  if (!rate.allowed) return Response.json({ error: "try-later" }, { status: 429 });
  try {
    const form = await request.formData(); const file = form.get("photo"); const jobId = z.uuid().parse(form.get("jobId"));
    if (!(file instanceof File)) return Response.json({ error: "invalid" }, { status: 400 });
    if (file.size > Math.min(MAX_UPLOAD_BYTES, 4 * 1024 * 1024)) return Response.json({ error: "too-large" }, { status: 413 });
    return Response.json(await uploadSupportPhoto(getDb(), createSupabaseFileStore(), viewer, jobId, new Uint8Array(await file.arrayBuffer())));
  } catch { return Response.json({ error: "unavailable" }, { status: 400 }); }
});
