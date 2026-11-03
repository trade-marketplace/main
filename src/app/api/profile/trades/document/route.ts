import { withRoleRoute } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { getUploadService } from "@/server/files/service";
import { UploadError } from "@/server/files/errors";
import { SIGNUP_TRADES } from "@/lib/auth/worker-signup";

export const GET = withRoleRoute(["TRADIE"], async (viewer, request: Request) => {
  const trade = SIGNUP_TRADES.find(item => item.value === new URL(request.url).searchParams.get("trade"))?.value;
  if (!trade) return Response.json({ error: "not-found" }, { status: 404 });
  try {
    const licence = await getDb().licence.findUnique({ where: { userId_trade: { userId: viewer.userId, trade } }, select: { documentPath: true } });
    if (!licence?.documentPath) return Response.json({ error: "not-found" }, { status: 404 });
    const signed = await getUploadService().documentUrl(viewer, licence.documentPath);
    return new Response(null, { status: 303, headers: { Location: signed.url, "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof UploadError && error.code === "not-found") return Response.json({ error: "not-found" }, { status: 404 });
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
});
