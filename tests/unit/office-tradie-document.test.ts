import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Viewer } from "@/server/auth/viewer";
const state = vi.hoisted(() => ({ viewer: null as Viewer | null, find: vi.fn(), sign: vi.fn() }));
vi.mock("@/server/auth/guard", async original => {
  const { createGuards } = await original<typeof import("@/server/auth/guard")>();
  return { withRoleRoute: createGuards(async () => state.viewer).withRoleRoute };
});
vi.mock("@/server/db", () => ({ getDb: () => ({ licence: { findFirst: state.find } }) }));
vi.mock("@/server/files/service", () => ({ getUploadService: () => ({ documentUrl: state.sign }) }));
const { GET } = await import("@/app/api/admin/tradies/document/route");
const userId = "17400000-0000-4000-8000-000000000001", request = () => new Request(`https://local.test/api/admin/tradies/document?userId=${userId}&trade=GAS`);
beforeEach(() => { vi.clearAllMocks(); state.viewer = null; state.find.mockResolvedValue({ documentPath: `licences/${userId}/${"a".repeat(32)}.webp` }); state.sign.mockResolvedValue({ url: "https://private-files.test/short-lived" }); });
describe("office licence document boundary", () => {
  it("never opens the database or signs a file for a signed-out, customer or tradie visitor", async () => {
    for (const role of [null, "CUSTOMER", "TRADIE"] as const) {
      state.viewer = role ? { userId, role, email: "fixture@example.test", firstName: "Fixture", emailVerified: true } : null; expect((await GET(request(), undefined)).status).toBe(role ? 403 : 401);
    }
    expect(state.find).not.toHaveBeenCalled(); expect(state.sign).not.toHaveBeenCalled();
  });
  it("uses only the selected licence's owner-bound file after office authorization", async () => {
    state.viewer = { userId: "office", role: "ADMIN", email: "office@example.test", firstName: "Office", emailVerified: true }; const response = await GET(request(), undefined);
    expect(response.status).toBe(303); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("location")).toBe("https://private-files.test/short-lived");
    expect(state.sign).toHaveBeenCalledWith(state.viewer, `licences/${userId}/${"a".repeat(32)}.webp`);
    state.find.mockResolvedValue({ documentPath: `licences/other-owner/${"a".repeat(32)}.webp` }); state.sign.mockClear();
    expect((await GET(request(), undefined)).status).toBe(404); expect(state.sign).not.toHaveBeenCalled();
  });
});
