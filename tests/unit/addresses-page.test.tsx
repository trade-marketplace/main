import { beforeEach, describe, expect, it, vi } from "vitest";
import AddressesPage from "@/app/(app)/profile/addresses/page";
import { requireUser } from "@/server/auth/guard";
import { listAddresses } from "@/server/account/addresses";
vi.mock("@/server/auth/guard", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/db", () => ({ getDb: () => ({}) }));
vi.mock("@/server/account/addresses", () => ({ listAddresses: vi.fn(async () => []) }));
vi.mock("@/components/account/Addresses", () => ({ Addresses: () => null }));
describe("saved addresses page", () => {
  beforeEach(() => vi.clearAllMocks());
  it("returns not-found for a tradie before reading addresses", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "tradie", role: "TRADIE", firstName: "Jack", email: "tradie@example.test", emailVerified: true });
    await expect(AddressesPage()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    expect(listAddresses).not.toHaveBeenCalled();
  });
  it("loads the authenticated customer's addresses and keeps the protected login destination", async () => {
    const viewer = { userId: "customer", role: "CUSTOMER" as const, firstName: "Sarah", email: "customer@example.test", emailVerified: true };
    vi.mocked(requireUser).mockResolvedValue(viewer); await AddressesPage();
    expect(requireUser).toHaveBeenLastCalledWith({ next: "/profile/addresses" });
    expect(listAddresses).toHaveBeenCalledWith(expect.anything(), viewer);
  });
});
