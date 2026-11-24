// Export CSV for the office Payments ledger (#176): every payment matching the list's filters and search (the same
// query string as the page), as a download. Office only: withRoleRoute checks the role on the server. Copied from
// /admin/jobs/export.
import { parseOfficePaymentsQuery } from "@/lib/office-payments";
import { withRoleRoute } from "@/server/auth/guard";
import { DatabaseNotConfiguredError } from "@/server/db";
import { exportOfficePayments, officePaymentsCsv } from "@/server/office/payments";

export const dynamic = "force-dynamic";

export const GET = withRoleRoute(["ADMIN"], async (viewer, request) => {
  const query = parseOfficePaymentsQuery(new URL(request.url).searchParams);
  try {
    const { rows, truncated } = await exportOfficePayments(viewer, query);
    const day = new Date().toISOString().slice(0, 10);
    return new Response(officePaymentsCsv(rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="payments-${day}.csv"`,
        "cache-control": "no-store",
        // More payments matched than one export holds: the office narrows the filters and exports again.
        ...(truncated ? { "x-export-truncated": "true" } : {}),
      },
    });
  } catch (error) {
    if (!(error instanceof DatabaseNotConfiguredError)) console.error("Payments export failed.", error);
    return new Response("Couldn't export the payments. Try again.", { status: 503, headers: { "cache-control": "no-store" } });
  }
});
