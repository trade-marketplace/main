import { getLicenceStaging } from "@/server/account/licence-upload";
import { withRoleRoute } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { createSupabaseFileStore } from "@/server/files/storage";
import { createLicenceDocumentUploader } from "@/server/account/licence-documents";
import { consumeForUser } from "@/server/rate-limit";
import { tradesRoute } from "@/server/account/trades-route";

export const POST = withRoleRoute(["TRADIE"], (viewer, request: Request) => tradesRoute(viewer, request, {
  db: getDb, staging: getLicenceStaging, limit: consumeForUser, upload: (worker, bytes) => createLicenceDocumentUploader(getDb(), createSupabaseFileStore())(worker, bytes),
}));
