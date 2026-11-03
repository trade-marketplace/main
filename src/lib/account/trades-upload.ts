import { LICENCE_UPLOAD_MAX_BYTES, type TradeResult, type TradeSave } from "./trades";

// The file travels directly to private Storage. Only small staging/sign and final form requests reach Vercel.
// Finalization reads and validates the real bytes on the server; the browser never chooses a final document path.
export const saveTrades: TradeSave = async form => {
  const body = new FormData(); for (const [key, value] of form) if (key !== "document") body.set(key, value);
  const file = form.get("document");
  if (form.get("trade") !== "OTHER" && file instanceof File && file.size) {
    if (file.size > LICENCE_UPLOAD_MAX_BYTES) return { ok: false, error: "invalid", fields: { document: "That file is over 10 MB. Choose a smaller one." } };
    const response = await fetch("/api/profile/trades/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ size: file.size }) });
    const stage = await response.json();
    if (!response.ok || !stage.ok) return stage as TradeResult;
    const uploaded = await fetch(stage.url, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" }, body: file });
    if (!uploaded.ok) return { ok: false, error: "unavailable" };
    body.set("stagedDocument", stage.path);
  }
  const response = await fetch("/api/profile/trades", { method: "POST", body });
  const answer = await response.json();
  return response.status === 401 || response.status === 403 ? { ok: false, error: "session-expired" } : answer;
};
