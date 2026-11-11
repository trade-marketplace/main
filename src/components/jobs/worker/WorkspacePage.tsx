import "server-only";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { loadWorkspace } from "@/server/jobs/worker-workspace";
import type { JobViewer } from "@/server/views";
import { Workspace, WorkspaceLoadError } from "./Workspace";
export async function WorkspacePage({ viewer, id }: { viewer: JobViewer; id: string }) {
  let job;
  try { job = await loadWorkspace(getDb(), viewer, id); }
  catch { return <WorkspaceLoadError />; }
  if (!job) notFound();
  return <Workspace key={`${viewer.userId}:${id}`} job={job} />;
}
