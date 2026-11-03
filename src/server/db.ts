import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { createDatabaseClient } from "./database-client";

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "The database isn't connected. Copy .env.example to .env.local and fill in DATABASE_URL and " +
        "DIRECT_URL from Supabase (Project Settings → Database → Connection string).",
    );
    this.name = "DatabaseNotConfiguredError";
  }
}

let client: PrismaClient | undefined;

/** The shared Prisma client. Created on first use, so nothing connects at import time or during a build. */
export function getDb(env: Record<string, string | undefined> = process.env): PrismaClient {
  const url = env.DATABASE_URL?.trim();
  if (!url) throw new DatabaseNotConfiguredError();
  client ??= createDatabaseClient(url);
  return client;
}
