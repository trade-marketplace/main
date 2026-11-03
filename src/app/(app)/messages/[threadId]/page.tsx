import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProblemThreads } from "@/components/messages/ProblemThreads";
import { privateMetadata } from "@/lib/metadata";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { getMessages, ProblemThreadError } from "@/server/messages/service";

export const metadata: Metadata = { ...privateMetadata, title: "Messages" };
export default async function Page({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  const viewer = await requireRole(["CUSTOMER", "TRADIE"], { next: `/messages/${threadId}` });
  let data;
  try { data = await getMessages(getDb(), viewer, threadId); }
  catch (error) {
    if (error instanceof ProblemThreadError) notFound();
    return <ProblemThreads state="error" data={{ role: viewer.role, viewerId: viewer.userId, threads: [], jobs: [], selected: null }} />;
  }
  return <ProblemThreads key={threadId} data={data} />;
}
