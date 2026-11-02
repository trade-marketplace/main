// Download statement (#165, D12): the signed-in tradie's PDF of what payroll has paid them this tax year, for their
// records and tax. Tradies only (withRoleRoute checks on the server); it only ever reads that tradie's payouts.
import { withRoleRoute } from "@/server/auth/guard";
import { DatabaseNotConfiguredError, getDb } from "@/server/db";
import { loadStatement, statementPdf } from "@/server/earnings/statement";
import { nzDay } from "@/lib/earnings";

export const dynamic = "force-dynamic";

export const GET = withRoleRoute(["TRADIE"], async (viewer) => {
  try {
    const now = new Date();
    const db = getDb();
    const profile = await db.profile.findUnique({ where: { id: viewer.userId }, select: { firstName: true, lastName: true } });
    const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || "Tradie";
    const statement = await loadStatement(db, viewer.userId, name, now);
    return new Response(new Uint8Array(statementPdf(statement)), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="earnings-statement-${nzDay(now)}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (!(error instanceof DatabaseNotConfiguredError)) console.error("Earnings statement failed.", error);
    return new Response("Couldn't make the statement. Try again.", { status: 503, headers: { "cache-control": "no-store" } });
  }
});
