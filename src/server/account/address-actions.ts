"use server";

import { revalidatePath } from "next/cache";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { deleteAddress, listAddresses, saveAddress, setDefaultAddress } from "./addresses";
import type { AddressResult } from "@/lib/account/addresses";

async function changed(run: () => Promise<AddressResult>): Promise<AddressResult> {
  try {
    const result = await run();
    // A cache failure after commit must not report a failed save and invite a duplicate create.
    if (result.ok) { try { revalidatePath("/profile/addresses"); } catch { /* The returned authoritative list is still current. */ } }
    return result;
  } catch { return { ok: false, error: "unavailable" }; }
}

export const listAddressesAction = withRole(["CUSTOMER"], async viewer => {
  try { return { ok: true as const, addresses: await listAddresses(getDb(), viewer) }; }
  catch { return { ok: false as const, error: "unavailable" as const }; }
});
export const saveAddressAction = withRole(["CUSTOMER"], async (viewer, input: unknown) => {
  return changed(() => saveAddress(getDb(), viewer, input));
});
export const deleteAddressAction = withRole(["CUSTOMER"], async (viewer, id: string) => {
  return changed(() => deleteAddress(getDb(), viewer, id));
});
export const setDefaultAddressAction = withRole(["CUSTOMER"], async (viewer, id: string) => {
  return changed(() => setDefaultAddress(getDb(), viewer, id));
});
