"use server";
import { revalidatePath } from "next/cache";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { DOCUMENT_BUCKET, PHOTO_BUCKET, createSupabaseFileStore } from "@/server/files/storage";
import { releaseJob } from "./worker-release";

export const releaseJobAction = withRole(["TRADIE"], async (viewer, jobId: string, input: unknown) => {
  const db = getDb();
  const { result, orphanPaths } = await releaseJob(db, viewer, jobId, input);
  if (result.status !== "released") return result;
  // My work and the board show this job differently now.
  revalidatePath("/dashboard"); revalidatePath(`/jobs/${jobId}`);
  // The draft's files are no longer referenced by this job. A document's path comes from its bytes, so the same file
  // sent for another job shares it: only remove what nothing else points at. Failing to tidy never undoes the hand-back.
  try {
    const store = createSupabaseFileStore();
    if (orphanPaths.photos.length) await store.remove(PHOTO_BUCKET, orphanPaths.photos);
    if (orphanPaths.documents.length) {
      const [evidence, materials] = await Promise.all([
        db.completionEvidence.findMany({ where: { cocPath: { in: orphanPaths.documents } }, select: { cocPath: true } }),
        db.jobMaterials.findMany({ where: { receiptPath: { in: orphanPaths.documents } }, select: { receiptPath: true } }),
      ]);
      const inUse = new Set([...evidence.map(row => row.cocPath), ...materials.map(row => row.receiptPath)]);
      const unused = orphanPaths.documents.filter(path => !inUse.has(path));
      if (unused.length) await store.remove(DOCUMENT_BUCKET, unused);
    }
  } catch { console.error("Hand-back: couldn't remove the old draft's files."); }
  return result;
});
