import "server-only";
import { isLicenceDocument, lockLicenceDocuments } from "@/server/account/licence-documents";
import { createSupabaseFileStore, DOCUMENT_BUCKET, type FileStore } from "@/server/files/storage";
import type { SchedulerRule } from "./rules";

/** Only unreferenced final files are deleted, under the same lock as all final uploads and licence saves. */
export function licenceDocumentCleanup(store: () => Pick<FileStore, "remove"> = createSupabaseFileStore): SchedulerRule {
  return {
    name: "licence-document-cleanup",
    async run({ db, limit }) {
      const due = await db.licenceDocumentCleanup.findMany({ orderBy: [{ createdAt: "asc" }, { path: "asc" }], take: limit });
      const result = { rule: "licence-document-cleanup", due: due.length, done: 0, skipped: 0, failed: 0 };
      for (const record of due) {
        try {
          const outcome = await db.$transaction(async tx => {
            await lockLicenceDocuments(tx, record.userId);
            if (!await tx.licenceDocumentCleanup.findUnique({ where: { path: record.path } })) return "skipped" as const;
            const referenced = await tx.licence.count({ where: { documentPath: record.path } });
            if (!referenced && isLicenceDocument(record.path, record.userId)) await store().remove(DOCUMENT_BUCKET, [record.path]);
            // A later last-reference replacement queues a shared document again. Keeping it here would let live
            // documents fill each cleanup batch indefinitely. Invalid paths are never sent to Storage.
            await tx.licenceDocumentCleanup.delete({ where: { path: record.path } });
            return referenced ? "skipped" as const : "done" as const;
          }, { timeout: 30_000 });
          result[outcome]++;
        } catch { result.failed++; console.error("Licence document cleanup unavailable."); }
      }
      return result;
    },
  };
}
