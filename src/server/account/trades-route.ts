import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { readTradeForm, type TradeResult } from "@/lib/account/trades";
import type { Viewer } from "@/server/auth/viewer";
import { MESSAGES, UploadError } from "@/server/files/errors";
import { MAX_UPLOAD_BYTES } from "@/server/files/images";
import { tryAgainText } from "@/lib/rate-limit";
import type { RateLimitDecision } from "@/server/rate-limit";
import { claimLicenceStage, ownsStage, type LicenceStaging } from "./licence-upload";
import { saveTrade } from "./trades";

export type TradesRouteDeps = {
  db: () => PrismaClient;
  limit: (name: "upload", userId: string) => Promise<RateLimitDecision>;
  staging: () => LicenceStaging;
  upload: (viewer: Viewer, bytes: Uint8Array) => Promise<{ path: string }>;
};
export async function tradesRoute(viewer: Viewer, request: Request, deps: TradesRouteDeps): Promise<Response> {
  const rate = await deps.limit("upload", viewer.userId);
  if (!rate.allowed) return Response.json({ ok: false, error: "try-later", message: `Too many tries. ${tryAgainText(rate.retryAfter)}` } satisfies TradeResult, { status: 429 });
  let staged: string | null = null;
  let claimedStage: string | null = null;
  try {
    const form = await request.formData();
    const file = form.get("document");
    if (file instanceof File && file.size > MAX_UPLOAD_BYTES) return Response.json({ ok: false, error: "invalid", fields: { document: MESSAGES.tooLarge } } satisfies TradeResult, { status: 413 });
    const suppliedStage = form.get("stagedDocument");
    if (typeof suppliedStage === "string" && suppliedStage) {
      if (!ownsStage(suppliedStage, viewer.userId)) return Response.json({ ok: false, error: "invalid", fields: { document: MESSAGES.notFound } } satisfies TradeResult, { status: 400 });
      staged = suppliedStage;
    }
    const upload = staged ? async () => {
      if (!await claimLicenceStage(deps.db(), viewer.userId, staged!)) throw new UploadError("not-found", MESSAGES.notFound);
      claimedStage = staged;
      return (await deps.upload(viewer, await deps.staging().read(staged!))).path;
    } : file instanceof File && file.size > 0 ? async () => (await deps.upload(viewer, new Uint8Array(await file.arrayBuffer()))).path : null;
    const result = await saveTrade(deps.db(), viewer.userId, readTradeForm(form), upload);
    return Response.json(result, { status: result.ok ? 200 : result.error === "forbidden" ? 403 : 400 });
  } catch (error) {
    if (error instanceof UploadError && error.code !== "storage-failed") return Response.json({ ok: false, error: "invalid", fields: { document: error.message } } satisfies TradeResult, { status: 400 });
    return Response.json({ ok: false, error: "unavailable" } satisfies TradeResult, { status: 503 });
  } finally {
    if (claimedStage) try { await deps.staging().remove(claimedStage); } catch { console.error("Licence staging cleanup unavailable."); }
  }
}
