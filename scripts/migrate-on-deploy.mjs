// Runs before `next build` on Vercel (the "vercel-build" script): applies any database migrations that haven't
// been applied yet, so the live database always matches the code that's being deployed.
//
// Only on PRODUCTION deploys (merges to main). Preview deploys build PR branches whose migrations aren't reviewed
// or merged yet, so they never touch the database schema. Without DIRECT_URL (database not connected) it skips.
// If a migration fails, the deploy fails, so the app never goes live against a database it doesn't match.
import { spawnSync } from "node:child_process";

/**
 * Decide what to do from the environment.
 * @param {Record<string, string | undefined>} env
 * @returns {{ run: boolean, reason: string }}
 */
export function decide(env) {
  if (env.VERCEL_ENV !== "production") {
    return { run: false, reason: `not a production deploy (VERCEL_ENV=${env.VERCEL_ENV ?? "unset"})` };
  }
  if (!env.DIRECT_URL?.trim()) {
    return { run: false, reason: "DIRECT_URL isn't set, so the database isn't connected" };
  }
  return { run: true, reason: "production deploy with a database" };
}

function main() {
  const { run, reason } = decide(process.env);
  if (!run) {
    console.log(`Database migrations: skipped (${reason}).`);
    return 0;
  }
  console.log("Database migrations: applying any that are pending (prisma migrate deploy)…");
  const result = spawnSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    console.error("Database migrations failed, so this deploy stops here. The live site keeps the previous version.");
    return result.status ?? 1;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
