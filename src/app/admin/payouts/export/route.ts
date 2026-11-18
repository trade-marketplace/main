// Download an exported payroll batch's CSV again (#166): `/admin/payouts/export?batch=<exportedAt>`. Reads only;
// exporting itself is the page's "Export payroll CSV" (a server action that marks the payouts and builds the file
// in one transaction). Office only: withRoleRoute checks the role on the server, and the read checks it again.
import { parseBatchKey } from "@/lib/office/payouts";
import { withRoleRoute } from "@/server/auth/guard";
import { DatabaseNotConfiguredError, getDb } from "@/server/db";
import { loadBatchCsv } from "@/server/office/payouts";

export const dynamic = "force-dynamic";

const plain = (text: string, status: number) =>
  new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export const GET = withRoleRoute(["ADMIN"], async (viewer, request) => {
  const key = parseBatchKey(new URL(request.url).searchParams.get("batch"));
  if (!key) return plain("That batch doesn’t exist.", 404);
  try {
    const file = await loadBatchCsv(getDb(), viewer, key);
    if (!file) return plain("That batch doesn’t exist.", 404);
    return new Response(file.csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${file.filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (!(error instanceof DatabaseNotConfiguredError)) console.error("Payroll batch download failed.", error);
    return plain("Couldn’t download the batch. Try again.", 503);
  }
});
