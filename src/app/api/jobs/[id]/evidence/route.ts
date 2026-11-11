import { z } from "zod";
import { withRoleRoute } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { addEvidenceDocument, addEvidencePhoto, evidencePhotoUrls } from "@/server/jobs/evidence";
import { MAX_UPLOAD_BYTES } from "@/server/files/images";
import { MESSAGES } from "@/server/files/errors";
import { consumeForUser } from "@/server/rate-limit";
import { tryAgainText } from "@/lib/rate-limit";
export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "private, no-store" };
export const POST = withRoleRoute(["TRADIE"], async (viewer, request: Request, { params }: Context) => {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ status: "forbidden" }, { status: 404, headers });
  const rate = await consumeForUser("upload", viewer.userId);
  if (!rate.allowed) return Response.json({ status: "invalid", message: `Too many tries. ${tryAgainText(rate.retryAfter)}` }, { status: 429, headers });
  try {
    // Bound bytes even when Content-Length is missing or incorrect, before multipart parsing.
    const reader = request.body?.getReader(); if (!reader) return Response.json({ status: "invalid", message: MESSAGES.empty }, { status: 400, headers });
    const chunks: Uint8Array[] = []; let total = 0;
    for (;;) { const item = await reader.read(); if (item.done) break; total += item.value.length; if (total > MAX_UPLOAD_BYTES + 64 * 1024) { await reader.cancel(); return Response.json({ status: "invalid", message: MESSAGES.tooLarge }, { status: 413, headers }); } chunks.push(item.value); }
    const bytes = Buffer.concat(chunks), form = await new Request(request.url, { method: "POST", headers: { "Content-Type": request.headers.get("content-type") ?? "" }, body: bytes }).formData();
    const file = form.get("file"), kind = form.get("kind");
    if (!(file instanceof File) || !["photo", "coc", "receipt"].includes(String(kind))) return Response.json({ status: "invalid", message: MESSAGES.empty }, { status: 400, headers });
    const input = new Uint8Array(await file.arrayBuffer());
    const result = kind === "photo" ? await addEvidencePhoto(getDb(), viewer, id, input, form.get("requestId")) : await addEvidenceDocument(getDb(), viewer, id, kind as "coc" | "receipt", input);
    return Response.json(result.status === "uploaded" ? { ...result, file: { ...result.file, name: file.name.slice(0, 200), size: file.size } } : result, { status: result.status === "uploaded" ? 200 : result.status === "forbidden" ? 404 : result.status === "invalid" ? 400 : 503, headers });
  } catch { return Response.json({ status: "unavailable" }, { status: 503, headers }); }
});
export const GET = withRoleRoute(["CUSTOMER", "TRADIE", "ADMIN"], async (viewer, _request: Request, { params }: Context) => {
  try { const photos = await evidencePhotoUrls(getDb(), viewer, (await params).id); return photos ? Response.json({ photos }, { headers }) : Response.json({ error: "not-found" }, { status: 404, headers }); }
  catch { return Response.json({ error: "unavailable" }, { status: 503, headers }); }
});
