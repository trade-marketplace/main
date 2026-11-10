"use server";
import { revalidatePath } from "next/cache";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { getStripe, PaymentsNotConfiguredError } from "@/server/payments/stripe";
import { VARIATION_PRICING_MESSAGES, type VariationPreviewResult, type VariationPublishResult } from "@/lib/office-variation";
import { publishOfficeVariation, readOfficeVariationPreview } from "./variation-commands";

export const previewOfficeVariationAction = withRole(["ADMIN"], async (viewer, input: unknown): Promise<VariationPreviewResult> => {
  try { return await readOfficeVariationPreview(getDb(), viewer, input); }
  catch { return { ok: false, error: "unavailable", message: "Can’t calculate this price. Try again." }; }
});
export const publishOfficeVariationAction = withRole(["ADMIN"], async (viewer, input: unknown): Promise<VariationPublishResult> => {
  try {
    let intents;
    try { intents = getStripe().paymentIntents; } catch (error) { if (!(error instanceof PaymentsNotConfiguredError)) throw error; intents = null; }
    const result = await publishOfficeVariation(getDb(), viewer, input, intents);
    if (result.ok) { revalidatePath("/admin", "layout"); revalidatePath("/notifications"); }
    return result;
  } catch { return { ok: false, error: "unavailable", message: VARIATION_PRICING_MESSAGES.unavailable }; }
});
