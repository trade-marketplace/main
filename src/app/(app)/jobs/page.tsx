import type { Metadata } from "next";
import { JobBoard } from "@/components/jobs/JobBoard";
import { SetupBanner, TradieSetupHome } from "@/components/jobs/TradieSetup";
import { boardHref, parseBoardQuery } from "@/lib/job-board";
import { privateMetadata } from "@/lib/metadata";
import { SETUP_HOME, showsSetupHome } from "@/lib/tradie-setup";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { loadJobBoard } from "@/server/jobs/board";
import { loadTradieSetup } from "@/server/workers/setup";

export const metadata: Metadata = { ...privateMetadata, title: "Jobs near you" };
export default async function JobBoardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseBoardQuery(await searchParams), viewer = await requireRole(["TRADIE"], { next: boardHref(query) });
  // D01 (#132): plain /jobs is the setup checklist until every step is done. A chosen board view (All jobs, a
  // filter, the map) is always the board, with a slim "Finish setup" banner while anything is left. If the
  // checklist can't be read, plain /jobs says so and offers a retry instead of guessing that setup is finished.
  let setup: Awaited<ReturnType<typeof loadTradieSetup>> = { ok: false };
  try { setup = await loadTradieSetup(getDb(), viewer.userId); } catch { /* No database: the retry state below. */ }
  if (setup.ok ? showsSetupHome(setup.setup, query) : boardHref(query) === SETUP_HOME) return <TradieSetupHome key={viewer.userId} firstName={viewer.firstName} result={setup} />;
  const initial = await loadJobBoard(getDb(), viewer, query);
  return <JobBoard key={viewer.userId} ownerId={viewer.userId} initial={initial} notice={setup.ok && !setup.setup.complete ? <SetupBanner setup={setup.setup} /> : undefined} />;
}
