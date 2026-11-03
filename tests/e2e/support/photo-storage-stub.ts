import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { startSecurityAuthStub, type SecurityAuthStubOptions } from "./security-auth-stub";

export const PHOTO_STORAGE_TEST_KEY = "sb_secret_photo_test_only_not_a_real_key";
/** Task-owned localhost Auth + private Storage stand-in. The app still uses its real guards, SDK and codecs. */
export async function startPhotoStorageStub(port = 54318, authOptions: SecurityAuthStubOptions = {}) {
  const auth = await startSecurityAuthStub(port + 1, authOptions);
  const objects = new Map<string, Buffer>(); const uploadTokens = new Map<string, string>(); const viewTokens = new Map<string, string>();
  const events: { method: string; path: string; bytes: number }[] = [];
  let uploadGate: Promise<void> | undefined;
  const server = createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*"); response.setHeader("Access-Control-Allow-Headers", "content-type,x-upsert"); response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,HEAD,OPTIONS");
    if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); const body = Buffer.concat(chunks);
    const url = new URL(request.url!, `http://127.0.0.1:${port}`);
    const send = (status: number, value: unknown) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
    try {
      if (url.pathname.startsWith("/auth/")) {
        const headers = new Headers(); for (const [key, value] of Object.entries(request.headers)) if (value && !["host", "content-length", "connection"].includes(key)) headers.set(key, Array.isArray(value) ? value.join(",") : value);
        const result = await fetch(`http://127.0.0.1:${port + 1}${url.pathname}${url.search}`, { method: request.method, headers, body: ["GET", "HEAD"].includes(request.method!) ? undefined : body });
        response.writeHead(result.status, { "Content-Type": "application/json" }); response.end(Buffer.from(await result.arrayBuffer())); return;
      }
      events.push({ method: request.method!, path: url.pathname, bytes: body.length });
      const service = request.headers.apikey === PHOTO_STORAGE_TEST_KEY;
      const path = decodeURIComponent(url.pathname.replace(/^\/storage\/v1\//, ""));
      if (path.startsWith("object/upload/sign/")) {
        const key = path.slice("object/upload/sign/".length);
        if (request.method === "POST" && service) { const token = randomUUID(); uploadTokens.set(token, key); return send(200, { url: `/object/upload/sign/${key}?token=${token}` }); }
        if (request.method === "PUT" && uploadTokens.get(url.searchParams.get("token") ?? "") === key) {
          if (objects.has(key)) return send(409, { error: "Duplicate", message: "Already exists" });
          objects.set(key, body); if (uploadGate) await uploadGate; return send(200, { Key: key, Id: randomUUID() });
        }
        return send(403, { error: "Unauthorized", message: "Private upload" });
      }
      if (path.startsWith("object/sign/")) {
        const key = path.slice("object/sign/".length);
        if (request.method === "POST" && service && objects.has(key)) { const token = randomUUID(); viewTokens.set(token, key); return send(200, { signedURL: `/object/sign/${key}?token=${token}` }); }
        if (request.method === "GET" && viewTokens.get(url.searchParams.get("token") ?? "") === key && objects.has(key)) { response.writeHead(200, { "Content-Type": "image/webp" }); response.end(objects.get(key)); return; }
        return send(403, { error: "Unauthorized", message: "Private photo" });
      }
      if (!service) return send(403, { error: "Unauthorized", message: "Private object" });
      if (path.startsWith("object/")) {
        const key = path.slice("object/".length);
        if (request.method === "DELETE") {
          const parsed = JSON.parse(body.toString()); for (const prefix of parsed.prefixes ?? []) objects.delete(`${key}/${prefix}`); return send(200, []);
        }
        if (request.method === "POST") { objects.set(key, body); return send(200, { Key: key, Id: randomUUID() }); }
        if (request.method === "HEAD") { response.writeHead(objects.has(key) ? 200 : 404); response.end(); return; }
        if (request.method === "GET" && objects.has(key)) { response.writeHead(200, { "Content-Type": key.startsWith("photos/") ? "image/webp" : "application/octet-stream" }); response.end(objects.get(key)); return; }
      }
      send(404, { error: "not-found", message: "Object not found" });
    } catch { send(500, { error: "unavailable", message: "Local storage stand-in unavailable" }); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return { objects, events, auth, holdUploads(gate?: Promise<void>) { uploadGate = gate; }, async close() { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await auth.close(); } };
}
