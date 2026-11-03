import type { Metadata } from "next";
import { ProblemThreads } from "@/components/messages/ProblemThreads";
import { privateMetadata } from "@/lib/metadata";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { getMessages } from "@/server/messages/service";

export const metadata: Metadata = { ...privateMetadata, title: "Messages" };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireRole(["CUSTOMER", "TRADIE"], { next: "/messages" });
  const params = await searchParams;
  let data;
  try { data = await getMessages(getDb(), viewer); }
  catch { return <ProblemThreads state="error" data={{ role: viewer.role, viewerId: viewer.userId, threads: [], jobs: [], selected: null }} />; }
  const jobId = typeof params.job === "string" && data.jobs.some(job => job.id === params.job) ? params.job : undefined;
  return <ProblemThreads data={data} jobId={jobId} />;
}
