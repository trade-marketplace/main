import type { Metadata } from "next";
import { AppShellView } from "@/components/app/AppShellView";
import { WorkerJobBoundary } from "@/components/jobs/WorkerJobBoundary";
import { boardHref, boardReturn, parseBoardQuery } from "@/lib/job-board";
import { guardDevPage } from "@/server/dev-pages";
import { BOARD_STATES, previewBoard } from "./preview-data";
import { BoardPreview } from "./BoardPreview";

export const metadata: Metadata = { title: "Job board (dev)", robots: { index: false, follow: false } };
export default async function JobBoardPreview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams, { state: requested, from } = params, state = BOARD_STATES.find(value => value === requested) ?? "ready";
  const board = previewBoard(state);
  const back = boardHref(parseBoardQuery(new URL(boardReturn(from, params.view), "https://preview.invalid").searchParams), "/dev/components/job-board", "state=ready");
  return <AppShellView viewer={{ role: "TRADIE", firstName: "Jack", lastName: "Wilson", email: "worker@demo.test", counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: state === "detail" ? boardReturn(from, params.view) : boardHref(parseBoardQuery(params)), base: `/dev/components/job-board?state=${state}` }}>
    {state === "detail" ? <WorkerJobBoundary job={board.cards[0]} back={back} /> : <BoardPreview board={board} state={state} />}
  </AppShellView>;
}
