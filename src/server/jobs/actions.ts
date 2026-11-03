"use server";

import { z } from "zod";
import { jobDraftSchema, POST_KEY_SCHEMA } from "@/lib/job-draft";
import { getViewer } from "@/server/auth/viewer";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { createSupabaseFileStore } from "@/server/files/storage";
import { draftPhotoUrl } from "./draft-photos";
import { loadDraft, saveDraft } from "./drafts";
import { postJob } from "./post-job";
import { validatePhotoPaths } from "./photo-upload";

const photoVersionSchema = z.union([z.object({ absent: z.literal(true) }).strict(), z.object({ postKey: POST_KEY_SCHEMA, paths: jobDraftSchema.shape.photoPaths.unwrap() }).strict()]);
type PhotoVersion = z.infer<typeof photoVersionSchema>;

export const saveDraftAction = withRole(["CUSTOMER"], async (viewer, input: unknown, expectedOwnerId?: string, photoVersion?: PhotoVersion, manualCategory?: unknown) => {
  // A focused wizard may survive a login in another tab. Never attach its old account's draft to the new one.
  if (expectedOwnerId !== undefined && viewer.userId !== expectedOwnerId) return { status: "forbidden" } as const;
  if (manualCategory !== undefined && typeof manualCategory !== "boolean") return { status: "invalid", fields: { category: "Type of job" } } as const;
  const version = photoVersionSchema.safeParse(photoVersion);
  if (!version.success) return { status: "unconfirmed" } as const;
  return saveDraft(getDb(), viewer, input, { manualCategory, ...("absent" in version.data ? { expectedDraftAbsent: true } : { expectedPostKey: version.data.postKey, expectedPhotoPaths: version.data.paths }), validatePhotos: (tx, key, paths) => validatePhotoPaths(tx, viewer, key, paths, createSupabaseFileStore) });
});

export const saveDraftPhotosAction = withRole(["CUSTOMER"], async (viewer, ownerId: string, postKey: string, photoPaths: string[], expectedPhotoPaths: string[]) => {
  if (viewer.userId !== ownerId) return { status: "forbidden" } as const;
  const expected = jobDraftSchema.shape.photoPaths.unwrap().safeParse(expectedPhotoPaths);
  if (!expected.success) return { status: "unconfirmed" } as const;
  return saveDraft(getDb(), viewer, { photoPaths }, { expectedPostKey: postKey, expectedPhotoPaths: expected.data, validatePhotos: (tx, key, paths) => validatePhotoPaths(tx, viewer, key, paths, createSupabaseFileStore) });
});

export const loadDraftAction = withRole(["CUSTOMER"], async (viewer) => loadDraft(getDb(), viewer));

export const loadDraftPhotosAction = withRole(["CUSTOMER"], async (viewer, ownerId: string, postKey: string) => {
  if (viewer.userId !== ownerId) return { status: "forbidden" } as const;
  const draft = await loadDraft(getDb(), viewer);
  if (!draft) return { status: "empty" } as const;
  return draft?.postKey === postKey ? { status: "loaded", photoPaths: draft.photoPaths ?? [] } as const : { status: "changed" } as const;
});

export async function postJobAction(input: unknown, postKey: string) {
  const viewer = await getViewer();
  return viewer ? postJob(getDb(), viewer, input, postKey) : { status: "needs-account" } as const;
}

export const draftPhotoUrlAction = withRole(["CUSTOMER"], async (viewer, postKey: string, path: string) =>
  draftPhotoUrl(createSupabaseFileStore(), viewer, postKey, path));
