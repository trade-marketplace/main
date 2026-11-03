"use server";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { getStripe, PaymentsNotConfiguredError } from "@/server/payments/stripe";
import { createSupabaseFileStore } from "@/server/files/storage";
import { requestVariation, type RequestVariationInput } from "./request";
import { priceVariation } from "./price";
import { approveVariation, declineVariation } from "./decide";
import { uploadVariationPhoto, variationPhotoUrls } from "./photos";
import { loadVariation } from "./view";

function intents() { try { return getStripe().paymentIntents; } catch (error) { if (error instanceof PaymentsNotConfiguredError) return null; throw error; } }
// No new screens or copy. Consumers keep their form values for these structured failures.
async function safe<T>(run: () => Promise<T>) { try { return await run(); } catch { console.error("Variation command unavailable."); return { ok: false, error: "unavailable" } as const; } }
export const requestVariationAction = withRole(["TRADIE"], (viewer, input: RequestVariationInput) => safe(() => requestVariation(getDb(), viewer, input)));
export const priceVariationAction = withRole(["ADMIN"], (viewer, id: string, revision: number, minutes?: number) => safe(() => priceVariation(getDb(), viewer, id, revision, minutes, intents())));
export const approveVariationAction = withRole(["CUSTOMER"], (viewer, id: string, revision: number) => safe(() => approveVariation(getDb(), viewer, id, revision, intents())));
export const declineVariationAction = withRole(["CUSTOMER"], (viewer, id: string, revision: number) => safe(() => declineVariation(getDb(), viewer, id, revision, intents())));
export const uploadVariationPhotoAction = withRole(["TRADIE"], (viewer, jobId: string, requestKey: string, bytes: Uint8Array) => safe(() => uploadVariationPhoto(getDb(), createSupabaseFileStore(), viewer, jobId, requestKey, bytes)));
export const variationPhotoUrlsAction = withRole(["CUSTOMER", "TRADIE", "ADMIN"], (viewer, id: string) => safe(() => variationPhotoUrls(getDb(), createSupabaseFileStore(), viewer, id)));
export const loadVariationAction = withRole(["CUSTOMER", "TRADIE", "ADMIN"], (viewer, id: string) => safe(() => loadVariation(getDb(), viewer, id)));
