import { withRoleRoute } from "@/server/auth/guard";
import { beginLicenceStage, getLicenceStaging } from "@/server/account/licence-upload";
import { getDb } from "@/server/db";
import { consumeForUser } from "@/server/rate-limit";
import { tryAgainText } from "@/lib/rate-limit";
import { LICENCE_UPLOAD_MAX_BYTES } from "@/lib/account/trades";
import { MESSAGES } from "@/server/files/errors";

export const POST = withRoleRoute(["TRADIE"], async (viewer, request: Request) => {
  const rate = await consumeForUser("upload", viewer.userId);
  if (!rate.allowed) return Response.json({ ok: false, error: "try-later", message: `Too many tries. ${tryAgainText(rate.retryAfter)}` }, { status: 429 });
  try {
    const input: unknown = await request.json();
    const size = input && typeof input === "object" && "size" in input ? input.size : null;
    if (typeof size !== "number" || !Number.isInteger(size) || size < 1 || size > LICENCE_UPLOAD_MAX_BYTES) return Response.json({ ok: false, error: "invalid", fields: { document: size === 0 ? MESSAGES.empty : MESSAGES.tooLarge } }, { status: 400 });
    const stage = await beginLicenceStage(getDb(), viewer.userId, getLicenceStaging());
    if (!stage) return Response.json({ ok: false, error: "try-later", message: "Too many tries. Try again later." }, { status: 429 });
    return Response.json({ ok: true, ...stage }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ ok: false, error: "unavailable" }, { status: 503 }); }
});
