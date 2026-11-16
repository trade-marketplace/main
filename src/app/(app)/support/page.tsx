import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SupportList, type SupportListData } from "@/components/messages/SupportList";
import { privateMetadata } from "@/lib/metadata";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { getSupportInbox, getSupportThread } from "@/server/messages/support";
export const metadata: Metadata = { ...privateMetadata, title: "Your messages" };
export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const viewer = await requireUser({ next: "/support" });
  if (viewer.role === "ADMIN") redirect("/admin/support");
  const query = await searchParams;
  let data: SupportListData | null = null, replied: Record<string, boolean> = {};
  try {
    const db = getDb(), inbox = await getSupportInbox(db, viewer, Number(query.page ?? 1));
    // The summary has no last-sender field. Reuse bounded authorized public history, without signing photos.
    const facts = await Promise.all(inbox.threads.map(async thread => [thread.id, (await getSupportThread(db, viewer, thread.id, async () => "")).messages.at(-1)?.office === true] as const));
    data = { page: inbox.page, pages: inbox.pages, threads: inbox.threads.map(({ id, subject, when, unread }) => ({ id, subject, when, unread })) };
    replied = Object.fromEntries(facts);
  } catch { /* Keep private read failures retryable without exposing database details. */ }
  return <SupportList role={viewer.role} data={data} replied={replied} />;
}
