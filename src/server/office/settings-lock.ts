import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { databaseSchema } from "@/server/database-client";

/** Hold live pricing rates through publication, without firing Settings' updated_at trigger. */
export async function lockPricingSettings(db: object, tx: Pick<Prisma.TransactionClient, "$queryRaw">) {
  // Schema comes only from the client's immutable server-side configuration, never action input.
  const schema = databaseSchema(db).replaceAll('"', '""');
  const settings = Prisma.raw(`"${schema}"."settings"`);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM ${settings} WHERE id = 1 FOR SHARE`);
}
