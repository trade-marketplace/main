// /admin/disputes (#172, F06): every open cancellation request and problem report, oldest first. The office layout
// already checks the role; the read checks it again because it shows what customers paid.
import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";

import { DisputesList } from "@/components/office/DisputesList";
import { disputePage, DISPUTES_PATH, type DisputeListData } from "@/lib/office-disputes";
import { requireRole } from "@/server/auth/guard";
import { DatabaseNotConfiguredError, getDb } from "@/server/db";
import { loadDisputeList } from "@/server/office/disputes";

export const metadata: Metadata = { title: "Cancellations & disputes" };

export default async function DisputesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const page = disputePage(Array.isArray(query.page) ? query.page[0] : query.page);
  const viewer = await requireRole(["ADMIN"], { next: page > 1 ? `${DISPUTES_PATH}?page=${page}` : DISPUTES_PATH });
  let data: DisputeListData | null = null;
  try {
    data = await loadDisputeList(getDb(), viewer, page);
  } catch (error) {
    unstable_rethrow(error);
    // Shown as "Can't load cases" with Try again; the details stay in the server log.
    if (!(error instanceof DatabaseNotConfiguredError)) console.error("Disputes: couldn't read the open cases.", error);
    return <DisputesList data={null} />;
  }
  if (!data) notFound();
  return <DisputesList data={data} />;
}
