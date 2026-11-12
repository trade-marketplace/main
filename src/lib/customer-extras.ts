/** The entire extra-work payload allowed across the customer boundary. */
export type CustomerExtra = {
  id: string;
  revision: number;
  status: "REQUESTED" | "PRICED" | "APPROVED" | "DECLINED";
  description: string;
  priceCents: number | null;
  photoCount: number;
  pricedAt: string | null;
  decidedAt: string | null;
};

export const EXTRA_PREVIEW_STATES = ["waiting-office", "priced-card", "dialog", "photo-open", "decline-confirm", "declining", "declined", "paying", "pay-error", "changed", "approved", "offline", "error", "loading"] as const;

/** Storage is optional. A caller also remembers the claim in memory for this mount. */
export function claimExtraDialog(id: string, revision: number, storage: Pick<Storage, "getItem" | "setItem">): boolean {
  const key = `tm:extra-seen:${id}:${revision}`;
  try {
    if (storage.getItem(key)) return false;
    storage.setItem(key, "1");
  } catch { /* A privacy setting must never prevent the customer opening extra work. */ }
  return true;
}
