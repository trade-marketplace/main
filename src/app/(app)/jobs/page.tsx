import type { Metadata } from "next";
import { JobBoard } from "@/components/jobs/JobBoard";
import { boardHref, parseBoardQuery } from "@/lib/job-board";
import { privateMetadata } from "@/lib/metadata";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { loadJobBoard } from "@/server/jobs/board";

export const metadata: Metadata = { ...privateMetadata, title: "Jobs near you" };
export default async function JobBoardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseBoardQuery(await searchParams), viewer = await requireRole(["TRADIE"], { next: boardHref(query) });
  const initial = await loadJobBoard(getDb(), viewer, query);
  return <JobBoard key={viewer.userId} ownerId={viewer.userId} initial={initial} />;
}
