"use server";

import { getViewer } from "@/server/auth/viewer";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { createSupabaseFileStore } from "@/server/files/storage";
import { draftPhotoUrl } from "./draft-photos";
import { loadDraft, saveDraft } from "./drafts";
import { postJob } from "./post-job";

export const saveDraftAction = withRole(["CUSTOMER"], async (viewer, input: unknown) => saveDraft(getDb(), viewer, input));

export const loadDraftAction = withRole(["CUSTOMER"], async (viewer) => loadDraft(getDb(), viewer));

export async function postJobAction(input: unknown, postKey: string) {
  const viewer = await getViewer();
  return viewer ? postJob(getDb(), viewer, input, postKey) : { status: "needs-account" } as const;
}

export const draftPhotoUrlAction = withRole(["CUSTOMER"], async (viewer, postKey: string, path: string) =>
  draftPhotoUrl(createSupabaseFileStore(), viewer, postKey, path));
