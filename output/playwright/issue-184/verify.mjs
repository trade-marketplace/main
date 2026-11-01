import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, openSync, writeFileSync } from "node:fs";

const node = "/tmp/node-v22.23.4-darwin-arm64/bin/node";
const npm = "/tmp/node-v22.23.4-darwin-arm64/lib/node_modules/npm/bin/npm-cli.js";
const env = { ...process.env,
  PATH: "/tmp/node-v22.23.4-darwin-arm64/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
  DATABASE_URL: "", DIRECT_URL: "", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
  PLAYWRIGHT_BROWSERS_PATH: "/tmp/tm-waitlist184-browsers", PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: "",
  E2E_DEV_BASE_URL: "",
};
const revision = (ref) => execFileSync("git", ["rev-parse", ref], { encoding: "utf8" }).trim();
const report = { base: revision("origin/main"), sourceCommit: revision("HEAD") };
for (const [name, args] of [["lint", ["run", "lint"]], ["typecheck", ["run", "typecheck"]], ["test", ["test", "--", "--maxWorkers=1"]], ["e2e", ["run", "e2e", "--", "--config", "output/playwright/e2e.config.ts", "--workers=2"]], ["waitlist", ["exec", "--", "playwright", "test", "tests/e2e/waitlist.spec.ts", "--config", "output/playwright/e2e.config.ts", "--workers=2"]]]) {
  const file = openSync(`output/playwright/issue-184/${name}-verified.log`, "w");
  console.log(`${name}: started ${new Date().toISOString()}`);
  const checkEnv = name === "waitlist" ? { ...env, E2E_DEV_BASE_URL: "http://127.0.0.1:4284" }
    : name === "test" ? { ...env, TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54884/postgres" } : env;
  const result = spawnSync(node, [npm, ...args], { env: checkEnv, stdio: ["ignore", file, file] });
  closeSync(file);
  report[name] = { status: result.status, signal: result.signal, finished: new Date().toISOString() };
  writeFileSync("output/playwright/issue-184/verification.json", JSON.stringify(report, null, 2));
  console.log(`${name}: exit ${result.status} ${result.signal ?? ""}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
