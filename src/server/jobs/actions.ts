"use server";

import { getViewer } from "@/server/auth/viewer";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { createSupabaseFileStore } from "@/server/files/storage";
import { draftPhotoUrl } from "./draft-photos";
import { loadDraft, saveDraft } from "./drafts";
import { postJob } from "./post-job";
import { validatePhotoPaths } from "./photo-upload";

export const saveDraftAction = withRole(["CUSTOMER"], async (viewer, input: unknown, expectedOwnerId?: string) => {
  // A focused wizard may survive a login in another tab. Never attach its old account's draft to the new one.
  if (expectedOwnerId !== undefined && viewer.userId !== expectedOwnerId) return { status: "forbidden" } as const;
  return saveDraft(getDb(), viewer, input, { validatePhotos: (tx, key, paths) => validatePhotoPaths(tx, viewer, key, paths, createSupabaseFileStore) });
});

export const saveDraftPhotosAction = withRole(["CUSTOMER"], async (viewer, ownerId: string, postKey: string, photoPaths: string[]) => {
  if (viewer.userId !== ownerId) return { status: "forbidden" } as const;
  return saveDraft(getDb(), viewer, { photoPaths }, { expectedPostKey: postKey, validatePhotos: (tx, key, paths) => validatePhotoPaths(tx, viewer, key, paths, createSupabaseFileStore) });
});

export const loadDraftAction = withRole(["CUSTOMER"], async (viewer) => loadDraft(getDb(), viewer));

export async function postJobAction(input: unknown, postKey: string) {
  const viewer = await getViewer();
  return viewer ? postJob(getDb(), viewer, input, postKey) : { status: "needs-account" } as const;
}

export const draftPhotoUrlAction = withRole(["CUSTOMER"], async (viewer, postKey: string, path: string) =>
  draftPhotoUrl(createSupabaseFileStore(), viewer, postKey, path));
