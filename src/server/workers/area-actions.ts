"use server";
import { revalidatePath } from "next/cache";
import type { WorkAreaInput, WorkAreaResult } from "@/lib/account/work-area";
import { withRole } from "@/server/auth/guard";
import { searchSignupAreasAction } from "@/server/auth/actions";
import type { SignupAreaResult } from "@/server/auth/work-area";
import { getDb } from "@/server/db";
import { saveWorkArea, setAvailable } from "./area";

export const saveWorkAreaAction = withRole(["TRADIE"], async (viewer, input: WorkAreaInput): Promise<WorkAreaResult> => {
  try {
    const result = await saveWorkArea(getDb(), viewer, input);
    if (result.ok) { revalidatePath("/profile/area"); revalidatePath("/jobs"); }
    return result;
  } catch { return { ok: false, error: "unavailable" }; }
});

export const setAvailableAction = withRole(["TRADIE"], async (viewer, available: boolean): Promise<WorkAreaResult> => {
  try {
    const result = await setAvailable(getDb(), viewer, available);
    if (result.ok) { revalidatePath("/profile/area"); revalidatePath("/jobs"); }
    return result;
  } catch { return { ok: false, error: "unavailable" }; }
});

export const searchWorkAreaAction = withRole(["TRADIE"], async (_viewer, query: string): Promise<SignupAreaResult> => {
  // Reuse sign-up's rate-limited lookup rather than introducing a second geocoding path.
  try { return await searchSignupAreasAction(query); }
  catch { return { mode: "manual", reason: "unavailable" }; }
});
