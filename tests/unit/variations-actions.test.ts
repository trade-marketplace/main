import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/mode";
import type { Viewer } from "@/server/auth/viewer";

const state = vi.hoisted(() => ({ viewer: null as Viewer | null, run: vi.fn(async (...args: unknown[]) => { void args; return { ok: true }; }), db: {}, store: {} }));
vi.mock("@/server/auth/viewer", () => ({ getViewer: async () => state.viewer }));
vi.mock("@/server/db", () => ({ getDb: () => state.db }));
vi.mock("@/server/files/storage", () => ({ createSupabaseFileStore: () => state.store }));
vi.mock("@/server/variations/request", () => ({ requestVariation: (...args: unknown[]) => state.run(...args) }));
vi.mock("@/server/variations/price", () => ({ priceVariation: (...args: unknown[]) => state.run(...args) }));
vi.mock("@/server/variations/decide", () => ({ approveVariation: (...args: unknown[]) => state.run(...args), declineVariation: (...args: unknown[]) => state.run(...args) }));
vi.mock("@/server/variations/photos", () => ({ uploadVariationPhoto: (...args: unknown[]) => state.run(...args), variationPhotoUrls: (...args: unknown[]) => state.run(...args) }));
vi.mock("@/server/variations/staging", () => ({ getVariationStaging: () => state.store, beginVariationStage: (...args: unknown[]) => state.run(...args), finishVariationStage: (...args: unknown[]) => state.run(...args) }));

import { approveVariationAction, declineVariationAction, priceVariationAction, requestVariationAction, beginVariationPhotoUploadAction, finishVariationPhotoUploadAction, variationPhotoUrlsAction } from "@/server/variations/actions";

beforeEach(() => { state.viewer = null; state.run.mockReset().mockResolvedValue({ ok: true }); });
const viewer = (role: Role): Viewer => ({ role, userId: "actor", firstName: "Test", email: "test@example.nz", emailVerified: true });
const input = { jobId: "job", requestKey: "key", description: "Extra work description", hours: 0.5, photoPaths: ["photo"] };
describe("variation server action role boundaries", () => {
  const cases = [
    { role: "TRADIE" as const, run: () => requestVariationAction(input) },
    { role: "TRADIE" as const, run: () => beginVariationPhotoUploadAction("job", "key", 9 * 1024 * 1024) },
    { role: "TRADIE" as const, run: () => finishVariationPhotoUploadAction("stage") },
    { role: "ADMIN" as const, run: () => priceVariationAction("variation", 1, 30) },
    { role: "CUSTOMER" as const, run: () => approveVariationAction("variation", 1) },
    { role: "CUSTOMER" as const, run: () => declineVariationAction("variation", 1) },
  ];
  for (const [index, entry] of cases.entries()) {
    it(`guards command ${index + 1} before calling storage, payments or a mutation`, async () => {
      expect(await entry.run()).toMatchObject({ ok: false, error: "session-expired" });
      for (const role of ["CUSTOMER", "TRADIE", "ADMIN"] as const) {
        state.viewer = viewer(role);
        if (role === entry.role) continue;
        expect(await entry.run()).toMatchObject({ ok: false, error: "forbidden" });
      }
      expect(state.run).not.toHaveBeenCalled();
      state.viewer = viewer(entry.role);
      expect(await entry.run()).toMatchObject({ ok: true });
      expect(state.run.mock.calls[0]).toContain(state.viewer);
    });
  }
  it("requires sign-in for photo signing and keeps service failures structured", async () => {
    expect(await variationPhotoUrlsAction("variation")).toMatchObject({ error: "session-expired" });
    state.viewer = viewer("TRADIE"); state.run.mockRejectedValueOnce(new Error("private provider details"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect(await variationPhotoUrlsAction("variation")).toEqual({ ok: false, error: "unavailable" }); expect(log.mock.calls.flat().join(" ")).not.toContain("private provider details"); }
    finally { log.mockRestore(); }
  });
});
