import { readFile } from "node:fs/promises";
import path from "node:path";
import { firebaseWebConfig } from "@/server/notifications/push-config";

export const dynamic = "force-dynamic";
let bundled: Promise<string> | undefined;
export async function GET() {
  const config = firebaseWebConfig();
  if (!config) return new Response(null, { status: 404 });
  bundled ??= readFile(path.join(process.cwd(), "public", "firebase-messaging-worker.js"), "utf8");
  const publicConfig = JSON.stringify(config).replace(/</g, "\\u003c");
  return new Response(`self.__TRADE_FIREBASE_CONFIG__=${publicConfig};\n${await bundled}`, { headers: {
    "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache", "Service-Worker-Allowed": "/", "X-Content-Type-Options": "nosniff",
  } });
}
