import "server-only";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { loadWorkspace } from "@/server/jobs/worker-workspace";
import type { JobViewer } from "@/server/views";
import { Workspace, WorkspaceLoadError } from "./Workspace";
import { myWorkReturn } from "@/lib/my-work";
export async function WorkspacePage({ viewer, id, back }: { viewer: JobViewer; id: string; back?: string }) {
  const myWorkHref = myWorkReturn(back) ?? "/dashboard";
  let job;
  try { job = await loadWorkspace(getDb(), viewer, id); }
  catch { return <WorkspaceLoadError myWorkHref={myWorkHref} />; }
  if (!job) notFound();
  return <Workspace key={`${viewer.userId}:${id}`} job={job} extras={job.extras} myWorkHref={myWorkHref} />;
}
