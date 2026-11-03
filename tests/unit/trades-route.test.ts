import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Viewer } from "@/server/auth/viewer";
import { stagePath } from "@/server/account/licence-upload";
import { MAX_UPLOAD_BYTES } from "@/server/files/images";
import { UploadError } from "@/server/files/errors";

vi.mock("@/server/account/trades", () => ({ saveTrade: vi.fn() }));
import { saveTrade } from "@/server/account/trades";
import { tradesRoute, type TradesRouteDeps } from "@/server/account/trades-route";

const viewer: Viewer = { userId: "10000000-0000-4000-8000-000000000001", role: "TRADIE", firstName: "Test", email: "test@example.test", emailVerified: true };
const db = {} as PrismaClient;
const deps = (): TradesRouteDeps => ({ db: () => db, staging: () => ({ sign: vi.fn(), read: vi.fn(), remove: vi.fn() }), limit: vi.fn(async () => ({ allowed: true as const })), upload: vi.fn(async () => ({ path: "a-private-path" })) });
function request(file?: File) {
  const form = new FormData(); form.set("trade", "ELECTRICAL"); form.set("number", "E 123456"); form.set("expiresOn", "2027-03-31");
  form.set("userId", "a-different-person"); if (file) form.set("document", file);
  return new Request("https://example.test/api/profile/trades", { method: "POST", body: form });
}

describe("licence save transport", () => {
  it("uses only the checked viewer and forwards server-uploaded paths, never a posted person id", async () => {
    const d = deps(); vi.mocked(saveTrade).mockImplementationOnce(async (_db, id, _input, upload) => {
      expect(id).toBe(viewer.userId); expect(await upload!()).toBe("a-private-path");
      return { ok: true, snapshot: { today: "2026-11-04", rows: [] } };
    });
    const result = await tradesRoute(viewer, request(new File(["photo"], "licence.jpg")), d);
    expect(result.status).toBe(200); expect(d.upload).toHaveBeenCalledWith(viewer, expect.any(Uint8Array));
    expect(d.limit).toHaveBeenCalledWith("upload", viewer.userId);
  });
  it("blocks exhausted upload limits and oversized files before calling the save or storage", async () => {
    const limited = deps(); limited.limit = async () => ({ allowed: false, retryAfter: 300 });
    const response = await tradesRoute(viewer, request(), limited);
    expect(response.status).toBe(429); expect(await response.json()).toMatchObject({ error: "try-later", message: "Too many tries. Try again in 5 minutes." });
    const d = deps(); expect((await tradesRoute(viewer, request(new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "huge.pdf")), d)).status).toBe(413);
    expect(d.upload).not.toHaveBeenCalled();
  });
  it("turns storage failures into a safe retry response without leaking provider details", async () => {
    vi.mocked(saveTrade).mockRejectedValueOnce(new Error("provider credential details"));
    const response = await tradesRoute(viewer, request(), deps());
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false, error: "unavailable" });
    vi.mocked(saveTrade).mockRejectedValueOnce(new UploadError("wrong-type", "Documents must be a PDF, JPG, PNG or HEIC file."));
    expect(await (await tradesRoute(viewer, request(), deps())).json()).toMatchObject({ fields: { document: "Documents must be a PDF, JPG, PNG or HEIC file." } });
  });
  it("counts a valid staged upload only at its grant, and cannot bypass limits with forged/replayed stages or Other", async () => {
    const path = stagePath(viewer.userId); const staging = { sign: vi.fn(), read: vi.fn(async () => new Uint8Array([1, 2])), remove: vi.fn() };
    const claim = vi.fn(async () => ({ count: 1 })); const d = deps(); d.db = () => ({ licenceUploadStage: { updateMany: claim } }) as unknown as PrismaClient; d.staging = () => staging;
    const staged = (trade = "ELECTRICAL") => { const body = new FormData(); body.set("trade", trade); body.set("number", "E 123456"); body.set("expiresOn", "2027-03-31"); body.set("stagedDocument", path); return new Request("https://example.test/api/profile/trades", { method: "POST", body }); };
    vi.mocked(saveTrade).mockImplementationOnce(async (_db, _id, _input, upload) => { await upload!(); return { ok: true, snapshot: { today: "2026-11-04", rows: [] } }; });
    expect((await tradesRoute(viewer, staged(), d)).status).toBe(200);
    expect(d.limit).not.toHaveBeenCalled(); expect(staging.read).toHaveBeenCalledWith(path); expect(staging.remove).toHaveBeenCalledWith(path);
    expect(claim).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ path, userId: viewer.userId, finalizedAt: null }) }));
    claim.mockResolvedValueOnce({ count: 0 });
    expect((await tradesRoute(viewer, staged(), d)).status).toBe(400); expect(d.limit).toHaveBeenCalledTimes(1);
    vi.mocked(saveTrade).mockResolvedValueOnce({ ok: true, snapshot: { today: "2026-11-04", rows: [] } });
    expect((await tradesRoute(viewer, staged("OTHER"), d)).status).toBe(200); expect(d.limit).toHaveBeenCalledTimes(2);
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it("keeps an owned stage unconsumed when a non-file field is invalid, then reuses it after correction", async () => {
    const instant = new Date("2026-11-03T11:05:00Z"); const path = stagePath(viewer.userId, instant); const claim = vi.fn(async () => ({ count: 1 })); const lookup = vi.fn<() => Promise<{ id: string } | null>>(async () => ({ id: "stage" }));
    const staging = { sign: vi.fn(), read: vi.fn(async () => new Uint8Array([1])), remove: vi.fn() }; const d = deps();
    d.now = () => instant; d.db = () => ({ licenceUploadStage: { updateMany: claim, findFirst: lookup } }) as unknown as PrismaClient; d.staging = () => staging;
    const send = (expiry: string) => { const body = new FormData(); body.set("trade", "ELECTRICAL"); body.set("number", "E 123456"); body.set("expiresOn", expiry); body.set("stagedDocument", path); return tradesRoute(viewer, new Request("https://example.test/api/profile/trades", { method: "POST", body }), d); };
    expect(await (await send("2026-11-03")).json()).toMatchObject({ ok: false, error: "invalid", fields: { expiresOn: expect.any(String) } });
    expect(claim).not.toHaveBeenCalled(); expect(staging.read).not.toHaveBeenCalled(); expect(staging.remove).not.toHaveBeenCalled(); expect(d.limit).not.toHaveBeenCalled();
    vi.mocked(saveTrade).mockImplementationOnce(async (_db, _id, _input, upload) => { await upload!(); return { ok: true, snapshot: { today: "2026-11-04", rows: [] } }; });
    expect((await send("2027-03-31")).status).toBe(200); expect(claim).toHaveBeenCalledOnce(); expect(staging.read).toHaveBeenCalledWith(path); expect(staging.remove).toHaveBeenCalledOnce(); expect(d.limit).not.toHaveBeenCalled();
    lookup.mockResolvedValueOnce(null);
    expect(await (await send("2026-11-03")).json()).toMatchObject({ ok: false, error: "invalid", fields: { document: expect.any(String) } });
    expect(d.limit).toHaveBeenCalledOnce(); expect(claim).toHaveBeenCalledOnce();
  });

});
