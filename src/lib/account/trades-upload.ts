import { LICENCE_UPLOAD_MAX_BYTES, type TradeResult, type TradeSave } from "./trades";

type UploadedStage = { file: File; path: string; expiresAt: number };

/** One saver per mounted form. A field correction can reuse an unconsumed upload, without storing files or
 * signed URLs in persistent browser storage. Ambiguous/consumed results always require a fresh grant. */
export function createTradesSaver(options: { request?: typeof fetch; now?: () => number } = {}): TradeSave {
  let cached: UploadedStage | null = null;
  const now = options.now ?? Date.now;
  const request: typeof fetch = (...args) => (options.request ?? fetch)(...args);
  return async form => {
    try {
      const body = new FormData(); for (const [key, value] of form) if (key !== "document") body.set(key, value);
      const file = form.get("document");
      if (form.get("trade") !== "OTHER" && file instanceof File && file.size) {
        if (cached && (cached.file !== file || cached.expiresAt <= now())) cached = null;
        if (file.size > LICENCE_UPLOAD_MAX_BYTES) { cached = null; return { ok: false, error: "invalid", fields: { document: "That file is over 10 MB. Choose a smaller one." } }; }
        if (!cached) {
          const response = await request("/api/profile/trades/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ size: file.size }) });
          const stage = await response.json();
          if (response.status === 401 || response.status === 403) return { ok: false, error: "session-expired" };
          if (!response.ok || !stage.ok) return stage as TradeResult;
          const uploaded = await request(stage.url, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" }, body: file });
          if (!uploaded.ok) return { ok: false, error: "unavailable" };
          body.set("stagedDocument", stage.path);
          if (typeof stage.expiresAt === "number" && Number.isFinite(stage.expiresAt) && stage.expiresAt > now() + 30_000) {
            cached = { file, path: stage.path, expiresAt: stage.expiresAt - 30_000 };
          }
        } else body.set("stagedDocument", cached.path);
      } else cached = null;
      const response = await request("/api/profile/trades", { method: "POST", body });
      const answer: TradeResult = await response.json();
      if (response.status === 401 || response.status === 403) { cached = null; return { ok: false, error: "session-expired" }; }
      // Only these field errors occur before the server claims the stage. A document error or uncertain result may
      // have consumed it already; keeping that path would trap the next retry on an unusable upload.
      if (response.status !== 400 || answer.ok || answer.error !== "invalid" || answer.fields.document) cached = null;
      return answer;
    } catch (error) { cached = null; throw error; }
  };
}

// The component uses createTradesSaver per form. Standalone callers retain a stateless transport.
export const saveTrades: TradeSave = form => createTradesSaver()(form);
