import { beforeEach, describe, expect, it, vi } from "vitest";
import { listAddressesAction, saveAddressAction, deleteAddressAction, setDefaultAddressAction } from "@/server/account/address-actions";
import { getViewer } from "@/server/auth/viewer";
import { deleteAddress, listAddresses, saveAddress, setDefaultAddress } from "@/server/account/addresses";

vi.mock("@/server/auth/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/server/db", () => ({ getDb: () => ({ local: true }) }));
vi.mock("@/server/account/addresses", () => ({ listAddresses: vi.fn(async () => []), saveAddress: vi.fn(async () => ({ ok: true, addresses: [] })), deleteAddress: vi.fn(async () => ({ ok: true, addresses: [] })), setDefaultAddress: vi.fn(async () => ({ ok: true, addresses: [] })) }));
const me = { userId: "23700000-0000-4000-8000-000000000001", role: "CUSTOMER" as const, firstName: "Sarah", email: "customer@example.test", emailVerified: true };
describe("customer address action boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(getViewer).mockResolvedValue(me); });
  it("passes the authenticated viewer to every owned command", async () => {
    await listAddressesAction(); await saveAddressAction({ label: "Home" }); await deleteAddressAction("address"); await setDefaultAddressAction("address");
    expect(listAddresses).toHaveBeenCalledWith(expect.anything(), me);
    expect(saveAddress).toHaveBeenCalledWith(expect.anything(), me, { label: "Home" });
    expect(deleteAddress).toHaveBeenCalledWith(expect.anything(), me, "address"); expect(setDefaultAddress).toHaveBeenCalledWith(expect.anything(), me, "address");
  });
  it("refuses a tradie and an expired session before calling any data service", async () => {
    vi.mocked(getViewer).mockResolvedValue({ ...me, role: "TRADIE" });
    expect(await listAddressesAction()).toEqual({ ok: false, error: "forbidden" });
    expect(await saveAddressAction({})).toEqual({ ok: false, error: "forbidden" });
    expect(await deleteAddressAction("address")).toEqual({ ok: false, error: "forbidden" });
    expect(await setDefaultAddressAction("address")).toEqual({ ok: false, error: "forbidden" });
    expect(saveAddress).not.toHaveBeenCalled(); expect(listAddresses).not.toHaveBeenCalled();
    vi.mocked(getViewer).mockResolvedValue(null);
    expect(await saveAddressAction({})).toMatchObject({ ok: false, error: "session-expired" });
  });
  it("returns the command result and keeps service errors private", async () => {
    expect(await saveAddressAction({})).toEqual({ ok: true, addresses: [] });
    vi.mocked(saveAddress).mockRejectedValueOnce(Error("Private street must not escape"));
    expect(await saveAddressAction({})).toEqual({ ok: false, error: "unavailable" });
  });
});
