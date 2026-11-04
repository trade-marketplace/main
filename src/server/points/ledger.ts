import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { QUOTE_POINTS } from "@/lib/points";

type Db = Pick<PrismaClient, "pointEntry"> | Pick<Prisma.TransactionClient, "pointEntry">;

/** A worker's points: the sum of their ledger (#488). */
export async function pointBalance(db: Db, workerId: string): Promise<number> {
  const { _sum } = await db.pointEntry.aggregate({ where: { workerId }, _sum: { delta: true } });
  return _sum.delta ?? 0;
}

/** +1 the first time a worker quotes a job; editing that quote earns nothing. Returns the points just earned. */
export async function awardQuotePoints(db: Db, workerId: string, jobId: string): Promise<number> {
  const { count } = await db.pointEntry.createMany({ data: [{ workerId, jobId, delta: QUOTE_POINTS, reason: "QUOTE" }], skipDuplicates: true });
  return count ? QUOTE_POINTS : 0;
}
