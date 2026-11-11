export const DECLINE_PRICE_REASONS = ["Too expensive", "Changed my mind", "Found someone else", "Something else"] as const;
export type DeclinePriceReason = typeof DECLINE_PRICE_REASONS[number];
export type DeclinePriceResult = { status: "declined" | "changed" | "forbidden" | "invalid" | "unavailable" };

export const priceReadyTicks = (category: string) => ["Labour, parts and call-out included", ...(category === "ELECTRICAL" ? ["Licensed electrician · CoC included"] : []), "No surprise bills"];
export const hasPreviousPrice = (current: number | null, previous: number | null) => current !== null && previous !== null && previous !== current;

/** If storage cannot remember this job, leave the final price visible without a reveal. */
export function claimPriceReveal(jobId: string, storage: Pick<Storage, "getItem" | "setItem">, reducedMotion: boolean): boolean {
  try {
    const key = `tm:price-seen:${jobId}`;
    if (storage.getItem(key)) return false;
    storage.setItem(key, "1");
    return !reducedMotion;
  } catch { return false; }
}
