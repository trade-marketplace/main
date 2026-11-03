import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Viewer } from "@/server/auth/viewer";
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
});
