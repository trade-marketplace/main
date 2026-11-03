import { afterEach, describe, expect, it, vi } from "vitest";
import { saveTrades } from "@/lib/account/trades-upload";
import { LICENCE_UPLOAD_MAX_BYTES } from "@/lib/account/trades";

function form(file: File) {
  const form = new FormData(); form.set("trade", "ELECTRICAL"); form.set("number", "E 123456"); form.set("expiresOn", "2027-03-31"); form.set("document", file); return form;
}
afterEach(() => vi.unstubAllGlobals());
describe("direct licence upload transport", () => {
  it("keeps a 6 MB PDF out of both Vercel request bodies and sends it only to the signed private upload URL", async () => {
    const document = new File([new Uint8Array(6 * 1024 * 1024)], "licence.pdf", { type: "application/pdf" });
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ ok: true, path: "owner/random-stage", url: "https://private.example.test/signed-upload?token=write-only" }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ ok: true, snapshot: { today: "2026-11-04", rows: [] } }));
    vi.stubGlobal("fetch", fetch); expect(await saveTrades(form(document))).toMatchObject({ ok: true });
    expect(fetch.mock.calls[0][0]).toBe("/api/profile/trades/upload"); expect(fetch.mock.calls[0][1]?.body).toBe(JSON.stringify({ size: document.size }));
    expect(fetch.mock.calls[1][0]).toBe("https://private.example.test/signed-upload?token=write-only"); expect(fetch.mock.calls[1][1]).toMatchObject({ method: "PUT", body: document });
    expect(fetch.mock.calls[2][0]).toBe("/api/profile/trades");
    const finalForm = fetch.mock.calls[2][1]?.body as FormData;
    expect(finalForm.get("document")).toBeNull(); expect(finalForm.get("stagedDocument")).toBe("owner/random-stage"); expect(finalForm.get("number")).toBe("E 123456");
  });
  it("blocks files over10 MB locally and never finalizes a failed staging upload", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(); vi.stubGlobal("fetch", fetch);
    expect(await saveTrades(form(new File([new Uint8Array(LICENCE_UPLOAD_MAX_BYTES + 1)], "big.pdf")))).toMatchObject({ ok: false, error: "invalid" }); expect(fetch).not.toHaveBeenCalled();
    fetch.mockResolvedValueOnce(Response.json({ ok: true, path: "owner/random-stage", url: "https://private.example.test/upload" })).mockResolvedValueOnce(new Response(null, { status: 500 }));
    expect(await saveTrades(form(new File(["pdf"], "licence.pdf")))).toEqual({ ok: false, error: "unavailable" }); expect(fetch).toHaveBeenCalledTimes(2);
  });
});
