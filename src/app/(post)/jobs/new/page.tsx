import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { SessionExpiredProvider } from "@/components/auth/SessionExpired";
import { PostJobWizard } from "@/components/jobs/PostJobWizard";
import { homeForRole } from "@/lib/auth/routes";
import { signupLink } from "@/lib/auth/signup";
import { privateMetadata } from "@/lib/metadata";
import { landingWizardDraft } from "@/lib/post-job-wizard";
import { logInAgainAction } from "@/server/auth/actions";
import { getViewer } from "@/server/auth/viewer";
import { getDb } from "@/server/db";
import { saveDraftAction } from "@/server/jobs/actions";
import { loadWizardDraft } from "@/server/jobs/drafts";

export const metadata: Metadata = { ...privateMetadata, title: "Post a job" };
export default async function NewJob({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await getViewer();
  if (viewer && viewer.role !== "CUSTOMER") redirect(homeForRole(viewer.role));
  const params = await searchParams;
  let posted;
  if (params.posted !== undefined) {
    const id = z.uuid().safeParse(params.posted);
    if (!id.success) notFound();
    if (!viewer) redirect(signupLink("/login", `/jobs/new?posted=${id.data}`));
    const job = await getDb().job.findFirst({ where: { id: id.data, customerId: viewer.userId }, select: { id: true, jobNumber: true } });
    if (!job) notFound();
    posted = { jobId: job.id, jobNumber: job.jobNumber };
  }
  let draft = null; let loadFailed = false;
  if (viewer) { try { draft = await loadWizardDraft(getDb(), viewer); } catch { loadFailed = true; } }
  return <SessionExpiredProvider logIn={logInAgainAction} email={viewer?.email} role={viewer?.role}>
    <PostJobWizard key={viewer?.userId ?? "guest"} ownerId={viewer?.userId} verified={viewer?.emailVerified} initialPosted={posted} initialDraft={draft?.draft ?? landingWizardDraft(params)} initialManualCategory={draft?.manualCategory} hasServerDraft={Boolean(draft)} loadFailed={loadFailed} save={saveDraftAction} initialNow={new Date().toISOString()} />
  </SessionExpiredProvider>;
}
