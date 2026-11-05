import type { Metadata } from "next";
import { OfficeShellView } from "@/components/office/OfficeShellView";
import { OfficeQueues } from "@/components/office/OfficeQueues";
import { parseQueueQuery } from "@/lib/office-queues";
import { guardDevPage } from "@/server/dev-pages";
import { previewQueues, QUEUE_PREVIEW_STATES, type QueuePreviewState } from "./preview-data";

export const metadata: Metadata = { title: "Office queues (dev)", robots: { index: false, follow: false } };
export default async function Preview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams, candidate = typeof params.state === "string" ? params.state : "price";
  const state: QueuePreviewState = (QUEUE_PREVIEW_STATES as readonly string[]).includes(candidate) ? candidate as QueuePreviewState : "price";
  const query = parseQueueQuery({ ...params, tab: params.tab ?? (["price", "extra", "cancel", "signoff", "unclaimed"].includes(state) ? state : "price"), q: params.q ?? (state === "search" ? "Jack" : state === "search-empty" ? "nothing matches" : "") });
  const data = previewQueues(state, query);
  if (params.urgent === "1") data.problems = data.problems.map(problem => ({ ...problem, topic: `Urgent · ${problem.topic}`, href: "/dev/components/office-job?problem=ready#problem-report" }));
  return <OfficeShellView viewer={{ role: "ADMIN", firstName: "Matt", lastName: "Larsen", email: "office@demo.test" }} counts={data.counts} testMode preview={{ at: "/admin", base: "/dev/components/office-queues" }}>
    <OfficeQueues query={query} data={state === "error" || state === "loading" ? null : data} loading={state === "loading"} offline={state === "offline"} basePath="/dev/components/office-queues" previewState={state} />
  </OfficeShellView>;
}
