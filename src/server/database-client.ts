import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Bind the ORM's configured schema to this exact client. Raw row locks must target the same relation,
// including isolated test schemas; PrismaPg's schema option does not change SQL search_path.
const schemas = new WeakMap<object, string>();

export function createDatabaseClient(connectionString: string, schema?: string): PrismaClient {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }, schema ? { schema } : undefined) });
  schemas.set(client, schema || "public");
  return client;
}

export function databaseSchema(client: object): string {
  const schema = schemas.get(client);
  if (!schema) throw new Error("Database client schema is not registered.");
  return schema;
}
