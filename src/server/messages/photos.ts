import "server-only";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Viewer } from "@/server/auth/viewer";
import { checkUpload, PHOTO_MAX_EDGE, toWebp } from "@/server/files/images";
import { MESSAGES } from "@/server/files/errors";
import { PHOTO_BUCKET, type FileStore } from "@/server/files/storage";
import { requireJobAccess } from "./service";

/** Reuses #96's signature checks, size cap, WebP resizing and EXIF removal; never exposes a public file URL. */
export async function uploadSupportPhoto(db: PrismaClient, files: FileStore, viewer: Pick<Viewer, "userId">, jobId: string, input: Uint8Array) {
  await requireJobAccess(db, viewer, jobId);
  const kind = checkUpload(input, ["jpeg", "png", "heic"], MESSAGES.photoType);
  const image = await toWebp(input, kind, PHOTO_MAX_EDGE);
  const path = `support/${jobId}/${viewer.userId}/${createHash("sha256").update(input).digest("hex").slice(0, 32)}.webp`;
  await files.put(PHOTO_BUCKET, path, image.bytes, image.contentType);
  return { path };
}
