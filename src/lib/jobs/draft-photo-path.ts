import { jobDraftSchema, POST_KEY_SCHEMA } from "@/lib/job-draft";
import type { PhotoSnapshot } from "./draft-photo-manager";

export function ownsDraftPhoto(userId: string, postKey: string, path: string): boolean {
  const key = POST_KEY_SCHEMA.safeParse(postKey);
  if (!key.success) return false;
  const prefix = `drafts/${userId}/${key.data}/`;
  return path.startsWith(prefix) && /^[0-9a-f]{32}\.webp$/.test(path.slice(prefix.length));
}

/** A saved-draft URL never advances past genuinely pending, failed or unacknowledged photo work. */
export function canResumeSavedPhotos(ownerId: string | null, postKey: string | undefined, input: unknown, state: PhotoSnapshot): boolean {
  const paths = jobDraftSchema.shape.photoPaths.nonoptional().safeParse(input);
  if (!ownerId || !postKey || !paths.success || new Set(paths.data).size !== paths.data.length
    || paths.data.some(path => !ownsDraftPhoto(ownerId, postKey, path))
    || state.restoring || state.saving || state.storageError || state.photos.length !== paths.data.length) return false;
  return state.photos.every((photo, index) => photo.status === "done" && photo.path === paths.data[index] && !photo.pendingAttach && !photo.needsRetry);
}
