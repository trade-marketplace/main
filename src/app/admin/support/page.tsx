import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { OfficeSupportInbox } from "@/components/office/OfficeSupport";
import { OFFICE_SUPPORT_PATH, officeSupportSearch, parseOfficeSupportQuery } from "@/lib/office-support";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { listOfficeSupport, type OfficeSupportPage } from "@/server/office/support";

export const metadata: Metadata = { title: "Support inbox" };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseOfficeSupportQuery(await searchParams);
  const actor = await requireRole(["ADMIN"], { next: `${OFFICE_SUPPORT_PATH}${officeSupportSearch(query)}` });
  let data: OfficeSupportPage | null = null;
  try { data = await listOfficeSupport(getDb(), actor, query); }
  catch (error) { unstable_rethrow(error); console.error("Support inbox could not be read."); }
  return <OfficeSupportInbox query={query} data={data} />;
}
