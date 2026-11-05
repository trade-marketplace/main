import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_POINT_LEVELS, type PointLevels } from "@/lib/points";

type Db = Pick<PrismaClient, "pointEntry" | "settings"> | Pick<Prisma.TransactionClient, "pointEntry" | "settings">;

/** The levels the office has set (#491), or the launch defaults before the settings row exists. */
export async function pointLevels(db: Pick<Db, "settings">): Promise<PointLevels> {
  const row = await db.settings.findUnique({ where: { id: 1 }, select: { starterPoints: true, quotePoints: true, claimPoints: true } });
  return row ? { starter: row.starterPoints, quote: row.quotePoints, claim: row.claimPoints } : DEFAULT_POINT_LEVELS;
}

/**
 * A worker's points: the starter points plus their ledger (#488). Starter points are a setting, not a ledger row,
 * so the office can tune them for everyone while the founders work out the right level.
 */
export async function pointBalance(db: Db, workerId: string, levels?: PointLevels): Promise<number> {
  const [{ _sum }, { starter }] = await Promise.all([
    db.pointEntry.aggregate({ where: { workerId }, _sum: { delta: true } }),
    levels ?? pointLevels(db),
  ]);
  return starter + (_sum.delta ?? 0);
}

/** Points the first time a worker quotes a job; editing that quote earns nothing. Returns the points just earned. */
export async function awardQuotePoints(db: Db, workerId: string, jobId: string): Promise<number> {
  const { quote } = await pointLevels(db);
  if (quote <= 0) return 0;
  const { count } = await db.pointEntry.createMany({ data: [{ workerId, jobId, delta: quote, reason: "QUOTE" }], skipDuplicates: true });
  return count ? quote : 0;
}

export class NotEnoughPointsError extends Error {
  constructor(readonly balance: number, readonly cost: number) { super("Not enough points to claim"); }
}

/**
 * Spends the claim cost inside the claim's transaction (the claim already holds the worker's eligibility lock, so
 * two claims by one worker can't both spend the same points). Throws NotEnoughPointsError to roll the claim back.
 */
export async function spendClaimPoints(db: Db, workerId: string, jobId: string): Promise<void> {
  const levels = await pointLevels(db);
  if (levels.claim <= 0) return;
  const balance = await pointBalance(db, workerId, levels);
  if (balance < levels.claim) throw new NotEnoughPointsError(balance, levels.claim);
  await db.pointEntry.create({ data: { workerId, jobId, delta: -levels.claim, reason: "CLAIM" } });
}
