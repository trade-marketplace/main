import "server-only";

import { getDb } from "@/server/db";

import { PROFILE_SELECT, type ProfileStore } from "./profile";

/** The `profiles` table: one row, always selected by the session's user id. */
export function prismaProfileStore(db = getDb): ProfileStore {
  return {
    find: (userId) => db().profile.findUnique({ where: { id: userId }, select: PROFILE_SELECT }),
    update: async (userId, data) => {
      await db().profile.update({ where: { id: userId }, data, select: { id: true } });
    },
  };
}
