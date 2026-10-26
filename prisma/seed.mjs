// `npm run db:seed`: demo accounts and a job in every status (#88). Run by `prisma db seed` (prisma.config.ts).
// Refuses anything but a local or preview database: see ./seed/guard.mjs and docs/TESTING.md (Seed data).

import { createClient } from "@supabase/supabase-js";
import pg from "pg";

import { checkSeedTarget, SeedRefusedError } from "./seed/guard.mjs";
import { plainAuthUsers, seedDemoData, supabaseAuthUsers } from "./seed/run.mjs";

async function main() {
  const target = checkSeedTarget(process.env);

  // Prisma reads `?schema=` from the URL; node-postgres doesn't, so use it as the search path.
  const url = new URL(target.url);
  const schema = url.searchParams.get("schema");
  url.searchParams.delete("schema");
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();

  try {
    if (schema) await db.query(`SET search_path TO "${schema.replaceAll('"', '""')}"`);
    const auth =
      target.auth.mode === "supabase"
        ? supabaseAuthUsers(
            createClient(target.auth.url, target.auth.secretKey, {
              auth: { persistSession: false, autoRefreshToken: false },
            }).auth.admin,
            /** @type {string} */ (target.password),
          )
        : plainAuthUsers(db);

    const result = await seedDemoData({ db, auth });

    console.log("Seeded demo data.");
    console.log("Accounts: customer@demo.test, tradie@demo.test, worker@demo.test, office@demo.test");
    console.log(
      target.auth.mode === "supabase"
        ? "Log in with the password in SEED_DEMO_PASSWORD."
        : "Plain Postgres: there's no Supabase Auth here, so these accounts can't log in (docs/TESTING.md).",
    );
    for (const job of result.jobs) console.log(`  TM-${job.jobNumber}  ${job.status.padEnd(13)} ${job.title}`);
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error instanceof SeedRefusedError ? error.message : error);
  process.exitCode = 1;
});
