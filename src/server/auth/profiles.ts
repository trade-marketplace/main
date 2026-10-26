import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import type { ProfileStore } from "@/server/auth/account";
import { PROFILE_SELECT } from "@/server/auth/viewer";
import { getDb } from "@/server/db";

/** The `profiles` table as sign-up and log-in see it. Connects on first use, like getDb(). */
export function prismaProfiles(db: () => PrismaClient = () => getDb()): ProfileStore {
  return {
    find: (id) => db().profile.findUnique({ where: { id }, select: PROFILE_SELECT }),
    create: (profile) => db().profile.create({ data: profile, select: PROFILE_SELECT }),
    markEmailVerified: (id, at) =>
      db().profile.update({ where: { id }, data: { emailVerifiedAt: at }, select: PROFILE_SELECT }),
  };
}
