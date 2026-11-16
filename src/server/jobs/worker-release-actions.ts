"use server";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { DOCUMENT_BUCKET, PHOTO_BUCKET, createSupabaseFileStore } from "@/server/files/storage";
import { releaseJob } from "./worker-release";

export const releaseJobAction = withRole(["TRADIE"], async (viewer, jobId: string, input: unknown) => {
  const { result, orphanPaths } = await releaseJob(getDb(), viewer, jobId, input);
  // The draft's files are no longer referenced. Failing to tidy them must not undo the hand-back.
  if (result.status === "released" && (orphanPaths.photos.length || orphanPaths.documents.length)) {
    try {
      const store = createSupabaseFileStore();
      if (orphanPaths.photos.length) await store.remove(PHOTO_BUCKET, orphanPaths.photos);
      if (orphanPaths.documents.length) await store.remove(DOCUMENT_BUCKET, orphanPaths.documents);
    } catch { console.error("Hand-back: couldn't remove the old draft's files."); }
  }
  return result;
});
