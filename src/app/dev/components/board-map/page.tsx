import type { Metadata } from "next";
import { AppShellView } from "@/components/app/AppShellView";
import { WorkerJobBoundary } from "@/components/jobs/WorkerJobBoundary";
import { BOARD_MAP_STATES, boardMapPreviewReturn } from "@/lib/board-map";
import { boardHref, parseBoardQuery } from "@/lib/job-board";
import { guardDevPage } from "@/server/dev-pages";
import { BoardMapDemo, BoardMapGallery } from "./BoardMapDemo";
import { previewMapBoard } from "./preview-data";

export const metadata: Metadata = { title: "Job board map (dev)", robots: { index: false, follow: false } };
export default async function BoardMapPreview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams, state = params.state === "gallery" || params.state === "detail" ? params.state : BOARD_MAP_STATES.find(value => value === params.state) ?? "ready";
  const query = parseBoardQuery(params);
  if (params.view === undefined && params.layout === undefined) query.view = "map";
  if (state === "chips-estimate" && params.kind === undefined) query.kind = "estimate";
  const board = previewMapBoard(state);
  return <AppShellView viewer={{ role: "TRADIE", firstName: "Jack", lastName: "Wilson", email: "worker@demo.test", emailVerified: true, counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: boardHref(query), base: `/dev/components/board-map?state=${state}` }}>
    {state === "gallery" ? <BoardMapGallery board={board} query={query} /> : state === "detail" ? <WorkerJobBoundary job={board.cards.find(card => card.id === params.job) ?? board.cards[0]} back={boardMapPreviewReturn(params.back)} /> : <BoardMapDemo board={board} state={state} query={query} />}
  </AppShellView>;
}
