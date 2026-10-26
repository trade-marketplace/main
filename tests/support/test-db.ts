// A throwaway Postgres schema per test file, migrated with the real migrations (docs/TESTING.md).
//
// Set TEST_DATABASE_URL to any Postgres you don't mind tests writing to, e.g. a local Docker one:
//   docker run --rm -d -p 54329:5432 -e POSTGRES_PASSWORD=postgres postgres:17
//   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:54329/postgres npm test
// Never the Supabase project. Without it, database tests are skipped locally and fail in CI.

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";

const run = promisify(execFile);

export const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim() || undefined;

// Tests create and drop schemas: refuse anything that looks like a Supabase project, real or staging.
if (testDatabaseUrl && /supabase\.(co|com)$/i.test(new URL(testDatabaseUrl).hostname)) {
  throw new Error("TEST_DATABASE_URL points at Supabase. Use a throwaway Postgres (docs/TESTING.md), never a project.");
}

// Locally they're skipped (vitest.config.ts says so once per run); in CI a missing database is a failure.
if (!testDatabaseUrl && process.env.CI) {
  throw new Error("TEST_DATABASE_URL isn't set, so the database tests can't run. CI must provide a Postgres service.");
}

export type TestSchema = {
  /** Prisma client for the test schema, connected as the owner (like the app's server code). */
  readonly db: PrismaClient;
  /** The schema's name, for raw SQL that needs it. */
  readonly name: string;
};

/**
 * Creates a fresh schema before the file's tests, runs `prisma migrate deploy` into it, and drops it afterwards.
 * Call it inside a `describe.skipIf(!testDatabaseUrl)` block.
 */
export function useTestSchema(testFile: string): TestSchema {
  const name = schemaName(testFile);
  let db: PrismaClient | undefined;
  let admin: PrismaClient | undefined;

  beforeAll(async () => {
    const url = testDatabaseUrl as string;
    admin = client(url);
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${name}"`);
    await run(path.resolve("node_modules/.bin/prisma"), ["migrate", "deploy"], {
      env: { ...process.env, DIRECT_URL: withSchema(url, name), DATABASE_URL: "", PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    });
    db = client(url, name);
  }, 60_000);

  afterAll(async () => {
    await db?.$disconnect();
    // Drop this schema's trigger on the shared auth.users first, on its own. Dropping it as part of DROP SCHEMA
    // would lock this schema's tables and then auth.users, while another file's DELETE FROM auth.users locks them
    // the other way round (its trigger fires into every schema): a deadlock.
    await admin?.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "delete_profile_${name}" ON auth.users`);
    await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
    await admin?.$disconnect();
  });

  return {
    get db() {
      if (!db) throw new Error("The test schema isn't ready: use it inside a test or hook.");
      return db;
    },
    name,
  };
}

function client(url: string, schema?: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }, schema ? { schema } : undefined) });
}

/** e.g. `test_schema_users_3_a1b2c3`: the file, the Vitest worker and a random part, so parallel runs never meet. */
function schemaName(testFile: string): string {
  const file = path.basename(testFile).replace(/\.test\.tsx?$/, "").replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  const worker = process.env.VITEST_POOL_ID ?? "0";
  return `test_${file.slice(0, 40)}_${worker}_${randomBytes(3).toString("hex")}`;
}

function withSchema(url: string, schema: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("schema", schema);
  return parsed.toString();
}
