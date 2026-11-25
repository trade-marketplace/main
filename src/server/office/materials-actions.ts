"use server";
// The job admin's Materials card decisions (#512). Office only: withRole answers `session-expired` or `forbidden` for
// anyone else, and decideMaterials reads the role again inside its transaction (./materials.ts).
import { revalidatePath } from "next/cache";

import type { MaterialsDecisionResult } from "@/lib/office/materials";
import { OFFICE_JOB_PATH } from "@/lib/office-job";
import { PAYOUTS_PATH } from "@/lib/office/payouts";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";

import { decideMaterials } from "./materials";

export const decideMaterialsAction = withRole(["ADMIN"], async (viewer, input: unknown): Promise<MaterialsDecisionResult | { ok: false; error: "forbidden" }> => {
  let result: Awaited<ReturnType<typeof decideMaterials>>;
  try {
    result = await decideMaterials(getDb(), viewer, input);
  } catch (error) {
    console.error("Materials check: couldn't run the decision.", error);
    return { ok: false, error: "unavailable", message: "Couldn’t save that. Nothing was changed. Try again." };
  }
  if (result.ok) {
    revalidatePath(`${OFFICE_JOB_PATH}/[id]`, "page");
    revalidatePath(PAYOUTS_PATH);
    revalidatePath("/earnings");
  }
  return result;
});
