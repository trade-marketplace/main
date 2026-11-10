import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SupportConversationView } from "@/components/messages/SupportConversation";
import { privateMetadata } from "@/lib/metadata";
import { supportReturn, supportThreadHref } from "@/lib/support-return";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { getSupportThread } from "@/server/messages/support";
import { ProblemThreadError } from "@/server/messages/service";

export const metadata: Metadata = { ...privateMetadata, title: "Support message" };
export default async function Page({ params, searchParams }: { params: Promise<{ threadId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ threadId }, query] = await Promise.all([params, searchParams]), returnTo = supportReturn(query.returnTo);
  const before = typeof query.before === "string" && /^[a-f0-9-]{36}$/i.test(query.before) ? query.before : undefined;
  const viewer = await requireRole(["CUSTOMER", "TRADIE"], { next: supportThreadHref(threadId, returnTo, before) });
  let thread;
  try { thread = await getSupportThread(getDb(), viewer, threadId, undefined, before); }
  catch (error) { if (error instanceof ProblemThreadError) notFound(); return <SupportConversationView viewerId={viewer.userId} thread={null} returnTo={returnTo} state="error" />; }
  return <SupportConversationView viewerId={viewer.userId} thread={thread} returnTo={returnTo} />;
}
