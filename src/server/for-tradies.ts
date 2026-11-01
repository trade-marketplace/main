import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db";
import { perHour, priceWork, ratesForTrade, type RateSettings } from "@/server/pricing/calculate";

export type TradieEarnings = { trade: "ELECTRICAL" | "OTHER"; hourlyCents: number; exampleCents: number; minutes: number; rateCents: number; holidayPay: boolean };
export type TradieData = { status: "ready"; earnings: TradieEarnings[] } | { status: "empty" | "error" | "loading" };

/** Public examples use current office settings. Only worker pay crosses the server boundary. */
export function tradieEarnings(settings: RateSettings): TradieData {
  return { status: "ready", earnings: (["ELECTRICAL", "OTHER"] as const).map((trade) => {
    const rates = ratesForTrade(trade, settings);
    const minutes = Math.max(rates.minMinutes, trade === "OTHER" ? 60 : 240);
    return { trade, hourlyCents: perHour(rates).workerEarnsCents,
      exampleCents: priceWork({ minutes, materialsCents: 0 }, rates).workerEarnsCents,
      minutes, rateCents: rates.workerRateCents, holidayPay: rates.holidayPayBps > 0 };
  }) };
}

export async function loadTradieData(db: Pick<PrismaClient, "settings"> | null = process.env.DATABASE_URL?.trim() ? getDb() : null): Promise<TradieData> {
  if (!db) return { status: "empty" };
  try {
    const settings = await db.settings.findUnique({ where: { id: 1 }, select: {
      sharedRateCents: true, otherRateCents: true, sharedMinMinutes: true, otherMinMinutes: true,
      holidayPayBps: true, onCostBps: true, marginBps: true, gstBps: true,
    } });
    return settings ? tradieEarnings(settings) : { status: "empty" };
  } catch {
    console.error("For tradies: rates unavailable");
    return { status: "error" };
  }
}
