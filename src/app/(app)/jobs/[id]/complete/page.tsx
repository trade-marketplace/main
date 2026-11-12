import { notFound } from "next/navigation";
import { z } from "zod";
import { FinishJob, FinishLoadError } from "@/components/jobs/worker/FinishJob";
import { privateMetadata } from "@/lib/metadata";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { loadFinish } from "@/server/jobs/evidence";
export const metadata = { ...privateMetadata, title: "Finish job" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireRole(["TRADIE"], { next: `/jobs/${id}/complete` });
  if (!z.uuid().safeParse(id).success) notFound();
  let job;
  try { job = await loadFinish(getDb(), viewer, id); } catch { return <FinishLoadError />; }
  if (!job) notFound();
  return <FinishJob key={`${viewer.userId}:${id}`} job={job} />;
}
