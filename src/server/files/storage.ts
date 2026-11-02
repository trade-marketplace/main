import "server-only";

import { createClient } from "@supabase/supabase-js";

import { MESSAGES, UploadError } from "./errors";

// Private Supabase Storage (#59, #96). Nothing here is public: files are read back only through signed links that
// expire. Uses the server-only secret key, so it must never be imported by browser code ("server-only" enforces it).

export const PHOTO_BUCKET = "photos";
export const DOCUMENT_BUCKET = "documents";
/** How long a viewing link works. Short, so a copied link goes stale quickly. */
export const SIGNED_URL_SECONDS = 5 * 60;

export type FileStore = {
  /** Saves the bytes at `path`, replacing any file already there (so a retry can't leave two copies). */
  put(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** A link to the file that stops working after `seconds`. */
  signedUrl(bucket: string, path: string, seconds: number): Promise<string>;
  remove(bucket: string, paths: string[]): Promise<void>;
};

export type InspectableFileStore = FileStore & { exists(bucket: string, path: string): Promise<boolean> };

export function createSupabaseFileStore(env: Record<string, string | undefined> = process.env): InspectableFileStore {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secretKey) {
    throw new Error("File storage isn't connected. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (see .env.example).");
  }
  const storage = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } }).storage;
  const failed = () => new UploadError("storage-failed", MESSAGES.storageFailed);
  return {
    async exists(bucket, path) {
      const { data, error } = await storage.from(bucket).exists(path);
      if (error) throw failed();
      return data;
    },
    async put(bucket, path, bytes, contentType) {
      const { error } = await storage.from(bucket).upload(path, bytes, { contentType, upsert: true });
      if (error) throw failed();
    },
    async signedUrl(bucket, path, seconds) {
      const { data, error } = await storage.from(bucket).createSignedUrl(path, seconds);
      if (error || !data) throw failed();
      return data.signedUrl;
    },
    async remove(bucket, paths) {
      const { error } = await storage.from(bucket).remove(paths);
      if (error) throw failed();
    },
  };
}
