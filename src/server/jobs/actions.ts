"use server";

import { getViewer } from "@/server/auth/viewer";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { createSupabaseFileStore } from "@/server/files/storage";
import { draftPhotoUrl } from "./draft-photos";
import { loadDraft, saveDraft } from "./drafts";
import { postJob } from "./post-job";

export const saveDraftAction = withRole(["CUSTOMER"], async (viewer, input: unknown, expectedOwnerId?: string, manualCategory?: unknown) => {
  // A focused wizard may survive a login in another tab. Never attach its old account's draft to the new one.
  if (expectedOwnerId !== undefined && viewer.userId !== expectedOwnerId) return { status: "forbidden" } as const;
  if (manualCategory !== undefined && typeof manualCategory !== "boolean") return { status: "invalid", fields: { category: "Type of job" } } as const;
  return saveDraft(getDb(), viewer, input, { manualCategory });
});

export const loadDraftAction = withRole(["CUSTOMER"], async (viewer) => loadDraft(getDb(), viewer));

export async function postJobAction(input: unknown, postKey: string) {
  const viewer = await getViewer();
  return viewer ? postJob(getDb(), viewer, input, postKey) : { status: "needs-account" } as const;
}

export const draftPhotoUrlAction = withRole(["CUSTOMER"], async (viewer, postKey: string, path: string) =>
  draftPhotoUrl(createSupabaseFileStore(), viewer, postKey, path));
