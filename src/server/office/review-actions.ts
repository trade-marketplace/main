"use server";
import { revalidatePath } from "next/cache";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { hideReview, showReview } from "./reviews";
import type { ReviewResult } from "@/lib/office/reviews";
export const hideReviewAction = withRole(["ADMIN"], async (viewer, id: string, reason: string): Promise<ReviewResult> => {
  try { const result = await hideReview(getDb(), viewer, id, reason); if (result.status === "hidden") { revalidatePath("/admin/reviews"); revalidatePath("/"); revalidatePath("/services/[trade]", "page"); revalidatePath("/jobs/[id]", "page"); } return result; } catch { return { status: "unavailable" }; }
});
export const showReviewAction = withRole(["ADMIN"], async (viewer, id: string): Promise<ReviewResult> => {
  try { const result = await showReview(getDb(), viewer, id); if (result.status === "shown") { revalidatePath("/admin/reviews"); revalidatePath("/"); revalidatePath("/services/[trade]", "page"); revalidatePath("/jobs/[id]", "page"); } return result; } catch { return { status: "unavailable" }; }
});
