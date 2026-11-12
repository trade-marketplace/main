import { createServer, request as httpRequest, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { startAuthStub } from "../../../scripts/screenshots/auth-stub";
import { PHOTO_STORAGE_TEST_KEY, startPhotoStorageStub } from "./photo-storage-stub";

export const WHOLE_FLOW_AUTH = "http://127.0.0.1:55440";
export function localWholeFlow(app: string, database: string) {
  const a = new URL(app), d = new URL(database);
  if (a.origin !== "http://127.0.0.1:3140" || a.pathname !== "/" || a.search || a.hash || d.hostname !== "127.0.0.1" || !["postgres:", "postgresql:"].includes(d.protocol) || d.pathname !== "/lane_d_191" || d.search || d.hash) throw Error("Whole-flow requires localhost app :3140 and disposable lane_d_191 database");
}
export async function wholeFlowServices(secret: string) {
  const auth = await startAuthStub(secret, 55441), files = await startPhotoStorageStub(55442);
  const proxy = createServer((request, response) => {
    const storage = request.url?.startsWith("/storage/");
    const upstream = httpRequest({ hostname: "127.0.0.1", port: storage ? 55442 : 55441, path: request.url, method: request.method, headers: request.headers }, result => {
      const headers = { ...result.headers };
      if (storage && decodeURIComponent(request.url ?? "").split("?")[0].endsWith(".pdf") && request.method === "GET" && result.statusCode === 200) headers["content-type"] = "application/pdf";
      response.writeHead(result.statusCode ?? 500, headers); result.pipe(response);
    });
    upstream.on("error", () => { response.writeHead(502); response.end(); }); request.pipe(upstream);
  });
  await new Promise<void>((resolve, reject) => { proxy.once("error", reject); proxy.listen(55440, "127.0.0.1", resolve); });
  const closeServer = async (server: Server) => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); };
  return { files, async close() { await closeServer(proxy); await closeServer(auth); await files.close(); } };
}
export async function startWholeFlowApp(database: string): Promise<{ stop(): Promise<void> }> {
  localWholeFlow("http://127.0.0.1:3140", database);
  const env = { ...process.env, DATABASE_URL: database, DIRECT_URL: database,
    NEXT_PUBLIC_SUPABASE_URL: WHOLE_FLOW_AUTH, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_screenshots_stub", SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_SECRET_KEY: PHOTO_STORAGE_TEST_KEY,
    STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "", PAYMENTS_LIVE: "", RESEND_API_KEY: "", MAPBOX_ACCESS_TOKEN: "pk.wholeflowlocal", NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN: "", GOOGLE_GENERATIVE_AI_API_KEY: "", GOOGLE_APPLICATION_CREDENTIALS: "", FCM_SERVICE_ACCOUNT_JSON: "", NEXT_TELEMETRY_DISABLED: "1", WHOLE_FLOW_TEST_NETWORK: "1", SCREENSHOT_DEV_PAGES: "" };
  const child: ChildProcess = spawn(process.execPath, ["--import", "./tests/e2e/support/whole-flow-network.mjs", "node_modules/next/dist/bin/next", "start", "--port", "3140"], { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; const collect = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-5000); };
  child.stdout?.on("data", collect); child.stderr?.on("data", collect);
  const stop = async () => { if (child.exitCode !== null || child.signalCode !== null) return; const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; };
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw Error(`Whole-flow app exited: ${output}`);
    try { if ((await fetch("http://127.0.0.1:3140/login")).ok) return { stop }; } catch { /* Startup only. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  await stop(); throw Error(`Whole-flow app did not start: ${output}`);
}

/** The sole non-screen step: same real event handler as payment tests, no provider request or SQL transition. */
export async function fakeCardPayment(database: string, paymentId: string): Promise<string> {
  localWholeFlow("http://127.0.0.1:3140", database);
  const { execFile } = await import("node:child_process"), { promisify } = await import("node:util");
  const source = `import { createDatabaseClient } from './src/server/database-client.ts'; import { handleStripeEvent } from './src/server/payments/webhook-events.ts';
    const target = new URL(process.env.WHOLE_FLOW_E2E_DATABASE_URL); if(target.hostname!=='127.0.0.1'||target.pathname!=='/lane_d_191'||target.search)throw Error('Local whole-flow database only');
    const db=createDatabaseClient(target.href); try { const payment=await db.payment.findUniqueOrThrow({where:{id:process.argv[1]}}); if(payment.kind!=='JOB'||payment.status!=='PENDING')throw Error('Expected real UI-created waiting payment');
    const event={id:'evt_whole_flow_'+payment.id,type:'payment_intent.succeeded',livemode:false,data:{object:{id:'pi_whole_flow_'+payment.id,amount:payment.amountCents,amount_received:payment.amountCents,currency:'nzd',metadata:{paymentId:payment.id,jobId:payment.jobId},status:'succeeded',last_payment_error:null}}};
    const first=await handleStripeEvent(db,event), replay=await handleStripeEvent(db,event); process.stdout.write(JSON.stringify({first,replay})); } finally {await db.$disconnect();}`;
  const answer = await promisify(execFile)(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", source, paymentId], { env: { ...process.env, WHOLE_FLOW_E2E_DATABASE_URL: database, RESEND_API_KEY: "", STRIPE_SECRET_KEY: "", SUPABASE_SECRET_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "" } });
  return answer.stdout.trim();
}
export const wholeFlowName = () => `Whole flow electrical job ${randomUUID().slice(0, 8)}`;
