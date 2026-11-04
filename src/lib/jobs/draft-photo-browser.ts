import { MAX_PHOTO_BYTES, MAX_PHOTOS } from "@/lib/media";

export const BROWSER_PHOTO_MAX_EDGE = 2000;
export type StoredDraftPhoto = { id: string; name: string; file?: File; path?: string; prepared?: boolean; pendingAttach?: boolean; needsRetry?: boolean };
export type PhotoDraftScope = { ownerId: string | null; postKey: string };
export const photoDraftKey = ({ ownerId, postKey }: PhotoDraftScope) => `${ownerId ?? "guest"}:${postKey}`;

/** File blobs stay on this device, including for guests. The account and draft are both part of the key. */
async function photoDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("trade.job-photos.v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Photo storage is unavailable"));
  });
}

export async function loadPhotoDraft(scope: PhotoDraftScope): Promise<StoredDraftPhoto[] | null> {
  const db = await photoDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("drafts", "readonly");
      const request = transaction.objectStore("drafts").get(photoDraftKey(scope));
      request.onsuccess = () => {
        const value = request.result;
        if (!Array.isArray(value)) return resolve(null);
        // Recovery may retain six server photos plus six unsynced local files; accepted uploads still cap at six.
        resolve(value.slice(0, scope.ownerId ? MAX_PHOTOS * 2 : MAX_PHOTOS).filter((photo): photo is StoredDraftPhoto => Boolean(photo && typeof photo.id === "string" && typeof photo.name === "string" && photo.name.length <= 255 && (!photo.file || photo.file instanceof Blob) && (!photo.path || typeof photo.path === "string" && photo.path.length <= 250)))
          .map(photo => { const file = photo.file as Blob | undefined; return { ...photo, pendingAttach: photo.pendingAttach === true, needsRetry: photo.needsRetry === true, file: file && !(file instanceof File) ? new File([file], photo.name, { type: file.type }) : file }; }));
      };
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

/** Resolve on transaction commit, rather than request success: quota failures can arrive at commit time. */
export async function savePhotoDraft(scope: PhotoDraftScope, photos: readonly StoredDraftPhoto[]): Promise<void> {
  const db = await photoDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("drafts", "readwrite");
      transaction.objectStore("drafts").put(photos.map(photo => ({ id: photo.id, name: photo.name, prepared: photo.prepared === true, ...(photo.pendingAttach ? { pendingAttach: true } : {}), ...(photo.needsRetry ? { needsRetry: true } : {}), ...(photo.file ? { file: photo.file } : {}), ...(photo.path ? { path: photo.path } : {}) })), photoDraftKey(scope));
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

/** The explicit Post-it handoff claims guest bytes once, before an account manager can write an empty scope. */
export async function initializeOwnedPhotoDraft(ownerId: string, postKey: string, photoIds: readonly string[]): Promise<"initialized" | "existing" | "changed" | "claimed"> {
  const db = await photoDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("drafts", "readwrite"); const store = transaction.objectStore("drafts");
      const source = store.get(photoDraftKey({ ownerId: null, postKey }));
      const target = store.get(photoDraftKey({ ownerId, postKey }));
      const claimKey = `handoff:${postKey}`; const claim = store.get(claimKey);
      let pending = 3; let result: "initialized" | "existing" | "changed" | "claimed" = "changed";
      const ready = () => {
        if (--pending) return;
        if (claim.result && claim.result.ownerId !== ownerId) { result = "claimed"; return; }
        if (target.result !== undefined) {
          // Even [] can represent an intentional removal; never recopy on retry.
          if (!Array.isArray(target.result)) return;
          store.put(claim.result ?? { ownerId, photoIds: [...photoIds] }, claimKey); result = "existing"; return;
        }
        const photos = source.result === undefined && !photoIds.length ? [] : source.result;
        if (!Array.isArray(photos) || photos.length > MAX_PHOTOS || JSON.stringify(photos.map(photo => photo?.id)) !== JSON.stringify(photoIds)
          || photos.some(photo => !photo || typeof photo.name !== "string" || photo.name.length > 255 || !(photo.file instanceof Blob))) return;
        // Browser paths are not upload authority. Each retained original goes through the normal owned uploader.
        store.put(photos.map(photo => ({ id: photo.id, name: photo.name, file: photo.file, prepared: photo.prepared === true })), photoDraftKey({ ownerId, postKey }));
        store.put({ ownerId, photoIds: [...photoIds] }, claimKey); result = "initialized";
      };
      source.onsuccess = target.onsuccess = claim.onsuccess = ready;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

/** Cleanup is scoped to the posted owner/key and leaves newly selected bytes in another scope untouched. */
export async function clearPhotoDraft(scope: PhotoDraftScope, expectedIds?: readonly string[]): Promise<boolean> {
  const db = await photoDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("drafts", "readwrite"); const store = transaction.objectStore("drafts");
      const key = photoDraftKey(scope); const read = store.get(key); let cleared = false;
      read.onsuccess = () => {
        if (read.result === undefined) { cleared = true; return; }
        if (!Array.isArray(read.result) || expectedIds && JSON.stringify(read.result.map(photo => photo?.id)) !== JSON.stringify(expectedIds)) return;
        store.delete(key); cleared = true;
      };
      transaction.oncomplete = () => resolve(cleared);
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

/** A claim is local recovery metadata, never authentication. Keep it if device cleanup is blocked. */
export async function guestPhotoClaim(ownerId: string, postKey: string): Promise<readonly string[] | null> {
  const db = await photoDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("drafts", "readonly"); const request = transaction.objectStore("drafts").get(`handoff:${postKey}`);
      request.onsuccess = () => resolve(request.result?.ownerId === ownerId && Array.isArray(request.result.photoIds) ? request.result.photoIds : null);
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
export async function releasePhotoClaim(ownerId: string, postKey: string) {
  const db = await photoDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("drafts", "readwrite"); const store = transaction.objectStore("drafts"); const key = `handoff:${postKey}`;
      const claim = store.get(key); claim.onsuccess = () => { if (claim.result?.ownerId === ownerId) store.delete(key); };
      transaction.oncomplete = () => resolve(); transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export function resizedDimensions(width: number, height: number, maxEdge = BROWSER_PHOTO_MAX_EDGE) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** HEIC stays untouched for #96's server decoder. Browser-decodable photos are resized before sending. */
export async function prepareDraftPhoto(file: File): Promise<File> {
  if (/image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) return file;
  const url = URL.createObjectURL(file);
  const image = new Image(); image.src = url;
  try {
    await image.decode();
    const { width, height } = resizedDimensions(image.naturalWidth, image.naturalHeight);
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("Unreadable photo");
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d"); if (!context) throw new Error("Photo processing unavailable");
    context.drawImage(image, 0, 0, width, height);
    const type = file.type === "image/png" || /\.png$/i.test(file.name) ? "image/png" : "image/jpeg";
    let blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Unreadable photo")), type, 0.85));
    // A noisy PNG can grow after re-encoding. Fall back to a bounded JPEG instead of exceeding the upload limit.
    if (blob.size > MAX_PHOTO_BYTES) blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Unreadable photo")), "image/jpeg", 0.85));
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + (blob.type === "image/png" ? ".png" : ".jpg"), { type: blob.type, lastModified: file.lastModified });
  } finally { URL.revokeObjectURL(url); }
}

/** XHR exposes real upload progress; only the signed write URL receives the file, never a Vercel body. */
export function uploadSignedPhoto(url: string, file: File, signal: AbortSignal, progress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    request.open("PUT", url);
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    request.setRequestHeader("x-upsert", "false");
    request.upload.onprogress = event => { if (event.lengthComputable) progress(event.loaded / event.total); };
    request.onload = () => { signal.removeEventListener("abort", abort); if (request.status >= 200 && request.status < 300) resolve(); else reject(new Error("Upload failed")); };
    request.onerror = () => { signal.removeEventListener("abort", abort); reject(new Error("Upload failed")); };
    request.onabort = () => { signal.removeEventListener("abort", abort); reject(new DOMException("Aborted", "AbortError")); };
    request.send(file);
  });
}
