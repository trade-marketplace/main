import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { DatabaseNotConfiguredError } from "@/server/db";

export type LicenceIntentWriter = Pick<PrismaClient, "licenceDocumentCleanup">;
let writer: PrismaClient | undefined;

/** Intents commit independently while an attachment transaction holds a primary connection. A separate, lazy
 * single-connection pool prevents concurrent uploads from exhausting the primary pool via nested checkouts. */
export function getLicenceIntentDb(env: Record<string, string | undefined> = process.env): LicenceIntentWriter {
  const url = env.DATABASE_URL?.trim();
  if (!url) throw new DatabaseNotConfiguredError();
  writer ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1 }) });
  return writer;
}
