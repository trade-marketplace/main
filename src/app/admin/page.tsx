import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { OfficeQueues } from "@/components/office/OfficeQueues";
import { parseQueueQuery, queueHref, type QueueData } from "@/lib/office-queues";
import { requireRole } from "@/server/auth/guard";
import { DatabaseNotConfiguredError, getDb } from "@/server/db";
import { getOfficeQueueStats, readOfficeQueues } from "@/server/office/queues";

export const metadata: Metadata = { title: "Queues" };
export default async function OfficeQueuesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseQueueQuery(await searchParams), viewer = await requireRole(["ADMIN"], { next: queueHref(query) });
  let data: QueueData | null = null;
  try { data = await readOfficeQueues(getDb(), viewer, query, new Date(), await getOfficeQueueStats(viewer)); }
  catch (error) { unstable_rethrow(error); if (!(error instanceof DatabaseNotConfiguredError)) console.error("Office queues: could not read current work."); }
  return <OfficeQueues query={query} data={data} />;
}
