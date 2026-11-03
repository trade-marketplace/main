"use server";
import { revalidatePath } from "next/cache";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { consumeForUser } from "@/server/rate-limit";
import { PRICING_MESSAGES, type PreviewResult, type PublishResult } from "@/lib/office-pricing";
import { publishOfficePrice, readOfficePricePreview, requestPricingPhotos } from "./pricing-commands";

export const previewOfficePriceAction = withRole(["ADMIN"], async (viewer, input: unknown): Promise<PreviewResult> => {
  try { return await readOfficePricePreview(getDb(), viewer, input); }
  catch { return { ok: false, error: "unavailable", message: "Can’t calculate this price. Try again." }; }
});
export const publishOfficePriceAction = withRole(["ADMIN"], async (viewer, input: unknown): Promise<PublishResult> => {
  try {
    const result = await publishOfficePrice(getDb(), viewer, input);
    if (result.ok) { revalidatePath("/admin", "layout"); revalidatePath("/notifications"); }
    return result;
  } catch { return { ok: false, error: "unavailable", message: PRICING_MESSAGES.unavailable }; }
});
export const requestPricingPhotosAction = withRole(["ADMIN"], async (viewer, input: unknown): Promise<PublishResult> => {
  const rate = await consumeForUser("message", viewer.userId);
  if (!rate.allowed) return { ok: false, error: "limited", message: PRICING_MESSAGES.limited };
  try {
    const result = await requestPricingPhotos(getDb(), viewer, input);
    if (result.ok) { revalidatePath("/messages"); revalidatePath("/notifications"); }
    return result;
  } catch { return { ok: false, error: "unavailable", message: PRICING_MESSAGES.unavailable }; }
});
