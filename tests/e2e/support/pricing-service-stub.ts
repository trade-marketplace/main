// Local verification only: the real SDK talks to this Auth/Storage double, never a Supabase project.
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { startAuthStub } from "../../../scripts/screenshots/auth-stub";
export async function startPricingServiceStub(secret: string, port = 54168) {
  const server = await startAuthStub(secret, port), auth = server.listeners("request")[0] as (request: IncomingMessage, response: ServerResponse) => void;
  const objects = new Map<string, { bytes: Buffer; type: string }>(), events: { method: string; path: string }[] = [];
  server.removeAllListeners("request");
  server.on("request", (request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`), path = decodeURIComponent(url.pathname);
    events.push({ method: request.method ?? "", path });
    if (!path.startsWith("/storage/v1/")) return auth(request, response);
    const send = (status: number, body: object) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)); };
    const signed = "/storage/v1/object/sign/", object = "/storage/v1/object/";
    if (path.startsWith(signed)) {
      const key = path.slice(signed.length);
      if (request.method === "POST") { request.resume(); return objects.has(key) ? send(200, { signedURL: `/object/sign/${key}?token=local-pricing-fixture` }) : send(404, { error: "not_found" }); }
      if (request.method === "GET" && url.searchParams.get("token") === "local-pricing-fixture") {
        const file = objects.get(key); if (!file) return send(404, { error: "not_found" });
        response.writeHead(200, { "content-type": file.type }); response.end(file.bytes); return;
      }
    }
    if (path.startsWith(object)) {
      const key = path.slice(object.length);
      if (request.method === "HEAD") { response.writeHead(objects.has(key) ? 200 : 404); response.end(); return; }
      if (request.method === "POST" || request.method === "PUT") {
        const chunks: Buffer[] = []; request.on("data", chunk => chunks.push(Buffer.from(chunk)));
        request.on("end", () => { objects.set(key, { bytes: Buffer.concat(chunks), type: String(request.headers["content-type"] ?? "image/webp") }); send(200, { Id: randomUUID(), Key: key }); }); return;
      }
    }
    send(404, { error: "not_part_of_local_stub" });
  });
  return { events, seed: (path: string, bytes: Buffer, type = "image/jpeg") => { objects.set(`photos/${path}`, { bytes, type }); },
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
