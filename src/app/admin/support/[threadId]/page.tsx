import type { Metadata } from "next";
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { OfficeSupportConversation } from "@/components/office/OfficeSupport";
import { OFFICE_SUPPORT_PATH, officeSupportJobHref, officeSupportThreadHref, parseOfficeSupportQuery } from "@/lib/office-support";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { ProblemThreadError } from "@/server/messages/service";
import { getOfficeSupport, type OfficeSupportDetail } from "@/server/office/support";

export const metadata: Metadata = { title: "Support" };
export default async function Page({ params, searchParams }: { params: Promise<{ threadId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ threadId }, raw] = await Promise.all([params, searchParams]);
  const query = parseOfficeSupportQuery(raw), valid = z.uuid().safeParse(threadId).success;
  const before = typeof raw.before === "string" ? raw.before : undefined;
  const actor = await requireRole(["ADMIN"], { next: valid ? officeSupportThreadHref(threadId, query, before) : OFFICE_SUPPORT_PATH });
  if (!valid) notFound();
  let data: OfficeSupportDetail | null;
  try { data = await getOfficeSupport(getDb(), actor, threadId, before); }
  catch (error) {
    unstable_rethrow(error);
    if (error instanceof ProblemThreadError && error.code === "forbidden") notFound();
    console.error("Support conversation could not be read.");
    return <OfficeSupportConversation query={query} data={null} />;
  }
  if (!data) notFound();
  if (data.kind === "job") redirect(officeSupportJobHref(data.jobId, query));
  return <OfficeSupportConversation key={threadId} query={query} data={data} />;
}
