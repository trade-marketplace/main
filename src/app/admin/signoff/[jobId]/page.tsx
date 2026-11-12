import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { SignoffReview } from "@/components/office/SignoffReview";
import { SignoffList } from "@/components/office/SignoffList";
import type { SignoffView } from "@/lib/office/signoff";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { loadSignoffReview } from "@/server/office/signoff";
export const metadata: Metadata = { title: "Check evidence" };
export default async function Page({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params, viewer = await requireRole(["ADMIN"], { next: `/admin/signoff/${jobId}` });
  let job: SignoffView | null = null;
  try { job = await loadSignoffReview(getDb(), viewer, jobId); if (!job) notFound(); }
  catch (error) { unstable_rethrow(error); }
  return job ? <SignoffReview key={`${job.id}:${job.revision}:${job.movedOn}`} job={job} /> : <SignoffList data={null} />;
}
