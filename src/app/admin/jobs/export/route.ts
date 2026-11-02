// Export CSV for the office "All jobs" list (#170): every job matching the list's filters, search and sort (the
// same query string as the page), as a download. Office only: withRoleRoute checks the role on the server.
import { parseOfficeJobsQuery } from "@/lib/office-jobs";
import { withRoleRoute } from "@/server/auth/guard";
import { DatabaseNotConfiguredError } from "@/server/db";
import { exportOfficeJobs, officeJobsCsv } from "@/server/office/jobs";

export const dynamic = "force-dynamic";

export const GET = withRoleRoute(["ADMIN"], async (_viewer, request) => {
  const query = parseOfficeJobsQuery(new URL(request.url).searchParams);
  try {
    const { rows, truncated } = await exportOfficeJobs(query);
    const day = new Date().toISOString().slice(0, 10);
    return new Response(officeJobsCsv(rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="jobs-${day}.csv"`,
        "cache-control": "no-store",
        // More jobs matched than one export holds: the office narrows the filters and exports again.
        ...(truncated ? { "x-export-truncated": "true" } : {}),
      },
    });
  } catch (error) {
    if (!(error instanceof DatabaseNotConfiguredError)) console.error("All jobs export failed.", error);
    return new Response("Couldn't export the jobs. Try again.", { status: 503, headers: { "cache-control": "no-store" } });
  }
});
