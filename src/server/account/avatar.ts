import "server-only";

import { createHash } from "node:crypto";

import { AVATAR_EDGE } from "@/lib/account/profile";
import { MESSAGES, UploadError } from "@/server/files/errors";
import type { FileKind } from "@/server/files/file-type";
import { checkUpload, toWebp } from "@/server/files/images";
import { PHOTO_BUCKET, SIGNED_URL_SECONDS, type FileStore } from "@/server/files/storage";

// The profile photo (#112), built on the upload service's checks (#96): the real type is read from the bytes,
// the picture is re-encoded as a small WebP with no location data, and it sits in the private photos bucket.
// The profile keeps the path, never a public link; people see it through a link that expires.

const AVATAR_KINDS: readonly FileKind[] = ["jpeg", "png", "heic"];
const AVATAR_PATH = /^avatars\/([0-9a-f-]{36})\/[0-9a-f]{32}\.webp$/;

export type AvatarDb = {
  find(userId: string): Promise<string | null>;
  setPath(userId: string, path: string): Promise<void>;
};

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex").slice(0, 32);

export function createAvatarService({ db, store }: { db: AvatarDb; store: FileStore }) {
  return {
    /** Replaces the signed-in person's photo and returns a link to the new one. Only their own row is touched. */
    async setAvatar(userId: string, input: Uint8Array): Promise<{ url: string }> {
      const kind = checkUpload(input, AVATAR_KINDS, MESSAGES.photoType);
      const photo = await toWebp(input, kind, AVATAR_EDGE);
      const path = `avatars/${userId}/${hash(input)}.webp`;
      const previous = await db.find(userId);
      await store.put(PHOTO_BUCKET, path, photo.bytes, photo.contentType);
      await db.setPath(userId, path);
      // The old photo is no longer linked from anywhere. Failing to tidy it must not fail the change.
      if (previous && previous !== path && AVATAR_PATH.exec(previous)?.[1] === userId) {
        await store.remove(PHOTO_BUCKET, [previous]).catch(() => undefined);
      }
      return { url: await store.signedUrl(PHOTO_BUCKET, path, SIGNED_URL_SECONDS) };
    },

    /** A link to a photo that expires, or null when there is none or Storage can't be reached (initials show instead). */
    async avatarUrl(userId: string, path: string | null): Promise<string | null> {
      if (!path || AVATAR_PATH.exec(path)?.[1] !== userId) return null;
      try {
        return await store.signedUrl(PHOTO_BUCKET, path, SIGNED_URL_SECONDS);
      } catch {
        return null;
      }
    },
  };
}

export { UploadError };
