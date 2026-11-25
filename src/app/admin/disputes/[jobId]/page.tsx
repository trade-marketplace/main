// /admin/disputes/[jobId] (#172, F06): one case: both sides, the money and the decision.
import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";

import { DisputeCase } from "@/components/office/DisputeCase";
import { disputeHref, type DisputeCaseView } from "@/lib/office-disputes";
import { requireRole } from "@/server/auth/guard";
import { DatabaseNotConfiguredError, getDb } from "@/server/db";
import { loadDisputeCase } from "@/server/office/disputes";

export const metadata: Metadata = { title: "Case" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DisputeCasePage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const viewer = await requireRole(["ADMIN"], { next: disputeHref(jobId) });
  // An address that isn't a job id is a 404, not a database error.
  if (!UUID.test(jobId)) notFound();
  let view: DisputeCaseView | null = null;
  try {
    view = await loadDisputeCase(getDb(), viewer, jobId);
  } catch (error) {
    unstable_rethrow(error);
    if (!(error instanceof DatabaseNotConfiguredError)) console.error("Disputes: couldn't read a case.", error);
    return <DisputeCase view={null} />;
  }
  if (!view) notFound();
  // Keyed by what the case is now, so a decision that moved it on starts the view (and its dialogs) afresh.
  return <DisputeCase key={`${view.id}:${view.status}:${view.problems.map((problem) => problem.status).join(",")}`} view={view} />;
}
