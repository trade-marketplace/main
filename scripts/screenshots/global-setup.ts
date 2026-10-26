import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { startAuthStub } from "./auth-stub";
import { resolvePlan, type PlanEntry } from "./shots";

export const OUT = process.env.SCREENSHOTS_DIR ?? "screenshots";

// Starts the stand-in Supabase Auth for the whole run and writes which routes were skipped (and why) for the
// comment. Workers see the secret through the environment: Playwright starts them after this runs.
export default async function globalSetup() {
  const plan = JSON.parse(readFileSync(join(OUT, "plan.json"), "utf8")) as { entries: PlanEntry[] };
  mkdirSync(join(OUT, "results"), { recursive: true });
  writeFileSync(join(OUT, "skipped.json"), `${JSON.stringify(resolvePlan(plan.entries).skipped, null, 2)}\n`);

  const secret = randomBytes(32).toString("hex");
  process.env.SCREENSHOTS_STUB_SECRET = secret;
  const server = await startAuthStub(secret);
  return () => new Promise<void>((resolve) => server.close(() => resolve()));
}
