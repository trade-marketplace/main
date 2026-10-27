import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import type { ProfileStore } from "@/server/auth/account";
import { PROFILE_SELECT } from "@/server/auth/viewer";
import { getDb } from "@/server/db";

/** The `profiles` table as sign-up and log-in see it. Connects on first use, like getDb(). */
export function prismaProfiles(db: () => PrismaClient = () => getDb()): ProfileStore {
  return {
    ensureWorker: async (id, details) => {
      try {
        await db().$transaction(async (tx) => {
          // Retrying signup/login repairs an interrupted create, but cannot replace an existing worker's data.
          if (await tx.workerProfile.findUnique({ where: { userId: id }, select: { userId: true } })) return;
          await tx.workerProfile.create({ data: { userId: id, baseSuburb: details.baseSuburb,
            areaRadiusKm: details.radiusKm, areaLat: details.point?.lat ?? null, areaLng: details.point?.lng ?? null } });
          await tx.workerTrade.createMany({ data: details.trades.map((trade) => ({ userId: id, trade })) });
          const licences = Object.entries(details.licences).map(([trade, number]) => ({ userId: id, trade: trade as Exclude<(typeof details.trades)[number], "OTHER">, number: number! }));
          if (licences.length) await tx.licence.createMany({ data: licences });
        });
      } catch (error) {
        // A simultaneous login may already have committed the complete worker record.
        if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002" ||
          !await db().workerProfile.findUnique({ where: { userId: id }, select: { userId: true } })) throw error;
      }
    },
    find: (id) => db().profile.findUnique({ where: { id }, select: PROFILE_SELECT }),
    create: (profile) => db().profile.create({ data: profile, select: PROFILE_SELECT }),
    markEmailVerified: (id, at) =>
      db().profile.update({ where: { id }, data: { emailVerifiedAt: at }, select: PROFILE_SELECT }),
  };
}
