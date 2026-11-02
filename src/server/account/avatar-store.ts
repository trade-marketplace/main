import "server-only";

import { getDb } from "@/server/db";
import { createSupabaseFileStore } from "@/server/files/storage";

import { createAvatarService } from "./avatar";

/** The avatar service wired to the real database and Storage. */
export function getAvatarService() {
  return createAvatarService({
    store: createSupabaseFileStore(),
    db: {
      find: async (userId) => (await getDb().profile.findUnique({ where: { id: userId }, select: { avatarPath: true } }))?.avatarPath ?? null,
      setPath: async (userId, path) => {
        await getDb().profile.update({ where: { id: userId }, data: { avatarPath: path }, select: { id: true } });
      },
    },
  });
}
