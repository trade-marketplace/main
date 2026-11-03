import { afterEach, describe, expect, it, vi } from "vitest";
import { createTradesSaver, saveTrades } from "@/lib/account/trades-upload";
import { LICENCE_UPLOAD_MAX_BYTES, type TradeResult } from "@/lib/account/trades";

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

describe("one form's unconsumed licence upload", () => {
  const success: TradeResult = { ok: true, snapshot: { today: "2026-11-04", rows: [] } };
  const invalidDate: TradeResult = { ok: false, error: "invalid", fields: { expiresOn: "Enter a current expiry date." } };
  function setup(results: ({ status: number; answer: TradeResult } | Error)[]) {
    let clock = 1_000_000, grants = 0, uploads = 0;
    const finals: FormData[] = [];
    const request = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      if (url === "/api/profile/trades/upload") {
        grants++;
        return Response.json({ ok: true, path: `owner/stage-${grants}`, url: "https://private.example.test/upload", expiresAt: clock + 120_000 });
      }
      if (url === "https://private.example.test/upload") { uploads++; return new Response(null); }
      finals.push(init!.body as FormData);
      const result = results.shift();
      if (result instanceof Error) throw result;
      if (!result) throw new Error("Unexpected finalization request");
      return Response.json(result.answer, { status: result.status });
    });
    return { save: createTradesSaver({ request, now: () => clock }), counts: () => ({ grants, uploads }), finals, advance: (ms: number) => { clock += ms; } };
  }
  it("corrects a rejected field without another grant or file upload, then clears the successful stage", async () => {
    const transport = setup([{ status: 400, answer: invalidDate }, { status: 200, answer: success }, { status: 200, answer: success }]);
    const file = new File(["licence"], "licence.pdf");
    expect(await transport.save(form(file))).toEqual(invalidDate);
    const corrected = form(file); corrected.set("expiresOn", "2028-03-31");
    expect(await transport.save(corrected)).toEqual(success);
    expect(transport.counts()).toEqual({ grants: 1, uploads: 1 });
    expect(transport.finals.map(body => body.get("stagedDocument"))).toEqual(["owner/stage-1", "owner/stage-1"]);
    expect(transport.finals[1].get("expiresOn")).toBe("2028-03-31");
    await transport.save(form(file));
    expect(transport.counts()).toEqual({ grants: 2, uploads: 2 });
  });
  it("does not carry a staged file into another mounted form or a different selected file", async () => {
    const first = setup([{ status: 400, answer: invalidDate }, { status: 200, answer: success }]);
    const file = new File(["licence"], "licence.pdf");
    await first.save(form(file));
    const second = setup([{ status: 200, answer: success }]);
    await second.save(form(file));
    expect(second.counts()).toEqual({ grants: 1, uploads: 1 });
    await first.save(form(new File(["replacement"], "licence.pdf")));
    expect(first.counts()).toEqual({ grants: 2, uploads: 2 });
  });
  it("discards an expired unconsumed stage", async () => {
    const transport = setup([{ status: 400, answer: invalidDate }, { status: 200, answer: success }]);
    const file = new File(["licence"], "licence.pdf");
    await transport.save(form(file)); transport.advance(120_000);
    await transport.save(form(file));
    expect(transport.counts()).toEqual({ grants: 2, uploads: 2 });
  });
  for (const failure of [
    { status: 400, answer: { ok: false, error: "invalid", fields: { document: "File not found." } } as TradeResult },
    { status: 503, answer: { ok: false, error: "unavailable" } as TradeResult },
    { status: 401, answer: { ok: false, error: "session-expired" } as TradeResult },
  ]) it(`does not reuse a possibly consumed stage after ${failure.status}/${failure.answer.ok ? "success" : failure.answer.error}`, async () => {
    const transport = setup([failure, { status: 200, answer: success }]);
    const file = new File(["licence"], "licence.pdf");
    await transport.save(form(file)); await transport.save(form(file));
    expect(transport.counts()).toEqual({ grants: 2, uploads: 2 });
  });
  it("uses a fresh stage after an ambiguous lost finalization response", async () => {
    const transport = setup([new Error("Connection lost"), { status: 200, answer: success }]);
    const file = new File(["licence"], "licence.pdf");
    await expect(transport.save(form(file))).rejects.toThrow("Connection lost");
    await transport.save(form(file));
    expect(transport.counts()).toEqual({ grants: 2, uploads: 2 });
  });
});
