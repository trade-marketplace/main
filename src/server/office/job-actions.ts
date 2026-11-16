"use server";
// The job admin view's actions (#171). Office only: withRole answers `session-expired` or `forbidden` for anyone
// else, and never redirects, so the dialog keeps what was typed. The work is in ./job-mutations.ts.
import { revalidatePath } from "next/cache";

import { type JobActionResult, OFFICE_JOB_PATH } from "@/lib/office-job";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { getStripe } from "@/server/payments/stripe";

import { performJobAction } from "./job-mutations";

export const jobAction = withRole(["ADMIN"], async (viewer, input: unknown): Promise<JobActionResult> => {
  let result: JobActionResult;
  try {
    result = await performJobAction(getDb(), { userId: viewer.userId }, input, new Date(), safeIntents());
  } catch (error) {
    // No database, or it dropped the connection before the transaction began. Nothing was changed.
    console.error("Job admin: couldn't run an office action.", error);
    return { ok: false, error: "unavailable", message: "Couldn’t save that. Nothing was changed. Try again." };
  }
  if (result.ok) revalidatePath(`${OFFICE_JOB_PATH}/[id]`, "page");
  return result;
});

/** Closing an open checkout needs Stripe. Without keys there is none to close, and one that exists is never guessed at. */
function safeIntents() {
  try { return getStripe().paymentIntents; } catch { return null; }
}
