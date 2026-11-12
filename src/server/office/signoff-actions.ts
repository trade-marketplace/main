"use server";
import { revalidatePath } from "next/cache";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { approveEvidence, flagEvidence } from "./signoff";
export const approveEvidenceAction = withRole(["ADMIN"], async (viewer, jobId: string, revision: string) => {
  const result = await approveEvidence(getDb(), viewer, jobId, revision);
  if (result.status === "approved") { revalidatePath("/admin/signoff"); revalidatePath(`/admin/signoff/${jobId}`); }
  return result;
});
export const flagEvidenceAction = withRole(["ADMIN"], async (viewer, jobId: string, revision: string, note: string) => {
  const result = await flagEvidence(getDb(), viewer, jobId, revision, note);
  if (result.status === "flagged") { revalidatePath("/admin/signoff"); revalidatePath(`/jobs/${jobId}`); revalidatePath(`/jobs/${jobId}/complete`); }
  return result;
});
