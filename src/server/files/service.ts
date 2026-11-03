import "server-only";

import { createHash } from "node:crypto";

import { getDb } from "@/server/db";

import { canViewJobFiles, type FileViewer, type JobAccess } from "./access";
import { MESSAGES, UploadError } from "./errors";
import type { FileKind } from "./file-type";
import { checkUpload, DOCUMENT_IMAGE_MAX_EDGE, PHOTO_MAX_EDGE, toWebp, type ProcessedFile } from "./images";
import {
  createSupabaseFileStore,
  DOCUMENT_BUCKET,
  PHOTO_BUCKET,
  SIGNED_URL_SECONDS,
  type FileStore,
} from "./storage";

// The upload service (#96): photos and documents go to private Storage, and people look at them through links that
// expire. The rules are in one place so every screen that takes a file behaves the same.

export const MAX_PHOTOS_PER_JOB = 10;
/** Customers can change a job's photos until it has a price. */
const PHOTO_EDITABLE_STATUSES = ["REVIEW", "QUOTE_BOUNTY"];
const PHOTO_KINDS: readonly FileKind[] = ["jpeg", "png", "heic"];
const DOCUMENT_KINDS: readonly FileKind[] = ["pdf", "jpeg", "png", "heic"];
/** Document folders, each holding one folder per worker: `licences/<user id>/<file>`. */
export type DocumentFolder = "licences" | "coc";
const DOCUMENT_PATH = /^(licences|coc)\/([0-9a-f-]{36})\/[0-9a-f]{32}\.(pdf|webp)$/;
// PDFs that run code or launch programs when opened have no place in a licence or certificate.
const ACTIVE_PDF_CONTENT = /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA)\b/;

type PhotoRow = { id: string; jobId: string; path: string; position: number };

/** The slice of the Prisma client this service uses, so tests can pass a small fake. */
export type UploadDb = {
  job: {
    findUnique(args: {
      where: { id: string };
      select: { customerId: true; workerId: true; status: true };
    }): Promise<JobAccess | null>;
  };
  jobPhoto: {
    findFirst(args: { where: { jobId: string; path: string } }): Promise<PhotoRow | null>;
    findMany(args: { where: { jobId: string }; orderBy: { position: "asc" } }): Promise<PhotoRow[]>;
    count(args: { where: { jobId: string } }): Promise<number>;
    create(args: { data: { jobId: string; path: string; position: number; uploadedById: string } }): Promise<PhotoRow>;
  };
};

export type UploadDeps = { db: UploadDb; store: FileStore };

export type SignedPhoto = { id: string; position: number; url: string; expiresInSeconds: number };

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex").slice(0, 32);

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export function createUploadService({ db, store }: UploadDeps) {
  async function loadJob(jobId: string): Promise<JobAccess> {
    const job = await db.job.findUnique({
      where: { id: jobId },
      select: { customerId: true, workerId: true, status: true },
    });
    if (!job) throw new UploadError("not-found", MESSAGES.notFound);
    return job;
  }

  return {
    /**
     * Adds a photo to a job: checks it really is a JPG, PNG or HEIC, turns it into a ~1600px WebP with no EXIF or
     * location, saves it privately and records it. The path comes from the picture itself, so if the connection
     * drops and the browser sends it again, the same photo is found and returned instead of added twice.
     */
    async addJobPhoto(viewer: FileViewer, jobId: string, input: Uint8Array) {
      const job = await loadJob(jobId);
      if (viewer.role !== "CUSTOMER" || job.customerId !== viewer.userId) {
        throw new UploadError("not-found", MESSAGES.notFound);
      }
      if (!PHOTO_EDITABLE_STATUSES.includes(job.status)) {
        throw new UploadError("not-allowed", MESSAGES.notAllowed);
      }
      const kind = checkUpload(input, PHOTO_KINDS, MESSAGES.photoType);
      const path = `jobs/${jobId}/${hash(input)}.webp`;

      const existing = await db.jobPhoto.findFirst({ where: { jobId, path } });
      if (existing) return existing;
      if ((await db.jobPhoto.count({ where: { jobId } })) >= MAX_PHOTOS_PER_JOB) {
        throw new UploadError("too-many-photos", MESSAGES.tooManyPhotos);
      }

      const photo = await toWebp(input, kind, PHOTO_MAX_EDGE);
      await store.put(PHOTO_BUCKET, path, photo.bytes, photo.contentType);
      try {
        const position = await db.jobPhoto.count({ where: { jobId } });
        return await db.jobPhoto.create({ data: { jobId, path, position, uploadedById: viewer.userId } });
      } catch (error) {
        // Two copies of the same retry arrived together: the other one won, so return its row.
        const winner = isUniqueViolation(error) ? await db.jobPhoto.findFirst({ where: { jobId, path } }) : null;
        if (winner) return winner;
        throw error;
      }
    },

    /** Links to a job's photos, cover first, each good for a few minutes. Only people who may see the job get them. */
    async jobPhotoUrls(viewer: FileViewer, jobId: string): Promise<SignedPhoto[]> {
      const job = await loadJob(jobId);
      if (!canViewJobFiles(viewer, job)) throw new UploadError("not-found", MESSAGES.notFound);
      const photos = await db.jobPhoto.findMany({ where: { jobId }, orderBy: { position: "asc" } });
      return Promise.all(
        photos.map(async (photo) => ({
          id: photo.id,
          position: photo.position,
          url: await store.signedUrl(PHOTO_BUCKET, photo.path, SIGNED_URL_SECONDS),
          expiresInSeconds: SIGNED_URL_SECONDS,
        })),
      );
    },

    /**
     * Saves a licence or Certificate of Compliance for the signed-in worker and returns its Storage path, which the
     * caller records (e.g. `licences.document_path`). PDFs are kept as they are; pictures become WebP with no
     * location data. The same file sent twice lands on the same path.
     */
    async addDocument(viewer: FileViewer, folder: DocumentFolder, input: Uint8Array): Promise<{ path: string }> {
      if (viewer.role !== "TRADIE") throw new UploadError("not-allowed", MESSAGES.notAllowed);
      const kind = checkUpload(input, DOCUMENT_KINDS, MESSAGES.documentType);
      let file: ProcessedFile;
      if (kind === "pdf") {
        if (ACTIVE_PDF_CONTENT.test(Buffer.from(input).toString("latin1"))) {
          throw new UploadError("wrong-type", MESSAGES.documentType);
        }
        file = { bytes: Buffer.from(input), contentType: "application/pdf", extension: "pdf" };
      } else {
        file = await toWebp(input, kind, DOCUMENT_IMAGE_MAX_EDGE);
      }
      const path = `${folder}/${viewer.userId}/${hash(input)}.${file.extension}`;
      await store.put(DOCUMENT_BUCKET, path, file.bytes, file.contentType);
      return { path };
    },

    /** A short-lived link to a document: its owner and the office only. */
    async documentUrl(viewer: FileViewer, path: string) {
      const owner = DOCUMENT_PATH.exec(path)?.[2];
      if (!owner || (viewer.role !== "ADMIN" && owner !== viewer.userId)) {
        throw new UploadError("not-found", MESSAGES.notFound);
      }
      return { url: await store.signedUrl(DOCUMENT_BUCKET, path, SIGNED_URL_SECONDS), expiresInSeconds: SIGNED_URL_SECONDS };
    },
  };
}

/** The service wired to the real database and Storage. */
export function getUploadService() {
  return createUploadService({ db: getDb() as unknown as UploadDb, store: createSupabaseFileStore() });
}
