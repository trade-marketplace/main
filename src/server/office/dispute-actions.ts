"use server";
// The disputes case view's decision (#172). Office only: withRole answers `session-expired` or `forbidden` for anyone
// else and never redirects, so the dialog keeps what was typed. The work is in ./dispute-decisions.ts.
import { revalidatePath } from "next/cache";

import { DISPUTES_PATH, type DisputeResult } from "@/lib/office-disputes";
import { OFFICE_JOB_PATH } from "@/lib/office-job";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { getStripe } from "@/server/payments/stripe";

import { decideDispute } from "./dispute-decisions";

export const decideDisputeAction = withRole(["ADMIN"], async (viewer, input: unknown): Promise<DisputeResult> => {
  let result: DisputeResult;
  try {
    result = await decideDispute(getDb(), { userId: viewer.userId }, input, safeRefunds());
  } catch (error) {
    // No database, or it dropped the connection before anything began. Nothing was changed.
    console.error("Disputes: couldn't run a decision.", error);
    return { ok: false, error: "unavailable", message: "Couldn’t save that. Nothing was changed. Try again." };
  }
  if (result.ok) {
    revalidatePath(DISPUTES_PATH);
    revalidatePath(`${DISPUTES_PATH}/[jobId]`, "page");
    revalidatePath(`${OFFICE_JOB_PATH}/[id]`, "page");
    revalidatePath("/admin");
  }
  return result;
});

/** Refunds are made in Stripe (#157). Without keys there is no Refunds API, and a refund is refused. */
function safeRefunds() {
  try {
    return getStripe().refunds;
  } catch {
    return null;
  }
}
