import { withRoleRoute } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { getUploadService } from "@/server/files/service";
import { isLicenceDocument } from "@/server/account/licence-documents";
import { parseTradieSelection } from "@/lib/office-tradies";

export const GET = withRoleRoute(["ADMIN"], async (viewer, request: Request) => {
  const query = new URL(request.url).searchParams, selected = parseTradieSelection(`${query.get("userId")}:${query.get("trade")}`);
  if (!selected) return Response.json({ error: "not-found" }, { status: 404 });
  try {
    const licence = await getDb().licence.findFirst({ where: { ...selected, user: { is: { role: "TRADIE" } } }, select: { documentPath: true } });
    if (!licence?.documentPath || !isLicenceDocument(licence.documentPath, selected.userId)) return Response.json({ error: "not-found" }, { status: 404 });
    const signed = await getUploadService().documentUrl(viewer, licence.documentPath);
    return new Response(null, { status: 303, headers: { Location: signed.url, "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ error: "unavailable" }, { status: 503 }); }
});
