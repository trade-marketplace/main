// Rules for photos, avatars and star ratings (#81). Safe on server and browser. The upload service itself (where
// files are stored, signed URLs, virus checks) is #96; these only decide what the picker accepts and what it says.

/** What the photo picker takes: JPG, PNG, HEIC (iPhones) and WebP, up to 10 MB each, 6 per job (WEBAPP_SPEC C03). */
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"] as const;
const PHOTO_EXTENSIONS = /\.(jpe?g|png|heic|heif|webp)$/i;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS = 6;
/** For <input accept>: the types plus the extensions, since some browsers report HEIC with no type. */
export const PHOTO_ACCEPT = [...PHOTO_TYPES, ".heic", ".heif"].join(",");
export const PHOTO_HINT = "JPG, PNG or HEIC up to 10 MB each";

export type FileLike = { name: string; type: string; size: number };

export type PhotoCheck<T extends FileLike> = {
  accepted: T[];
  /** One plain sentence per problem, ready to show (never a code). */
  problems: string[];
};

/** Which of `files` can be added to `existing` photos already there, and why the others can't. */
export function checkPhotos<T extends FileLike>(
  files: readonly T[],
  { existing = 0, max = MAX_PHOTOS, maxBytes = MAX_PHOTO_BYTES }: { existing?: number; max?: number; maxBytes?: number } = {},
): PhotoCheck<T> {
  const accepted: T[] = [];
  const problems: string[] = [];
  let tooMany = 0;
  for (const file of files) {
    const isPhoto = (PHOTO_TYPES as readonly string[]).includes(file.type) || (!file.type && PHOTO_EXTENSIONS.test(file.name));
    if (!isPhoto) {
      problems.push(`“${file.name}”: use JPG, PNG or HEIC.`);
    } else if (file.size > maxBytes) {
      problems.push(`“${file.name}”: max ${formatBytes(maxBytes)}.`);
    } else if (existing + accepted.length >= max) {
      tooMany += 1;
    } else {
      accepted.push(file);
    }
  }
  if (tooMany > 0) {
    problems.push(`${max} photos maximum.`);
  }
  return { accepted, problems };
}

/** 2_500_000 → "2.4 MB"; 10 MB stays "10 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

/** "2 of 6 · JPG, PNG or HEIC up to 10 MB each" (cus-post-2). */
export function photoCountLine(count: number, max = MAX_PHOTOS): string {
  return `${count} / ${max}`;
}

/** A rating shown in whole and half stars: 4.3 → 4.5 → [4 full, 1 half, 0 empty]. Out of 5. */
export function starParts(value: number): { full: number; half: boolean; empty: number } {
  const halves = Math.round(Math.min(5, Math.max(0, Number.isFinite(value) ? value : 0)) * 2);
  const full = Math.floor(halves / 2);
  const half = halves % 2 === 1;
  return { full, half, empty: 5 - full - (half ? 1 : 0) };
}

/** What a screen reader hears for a rating: "4.5 out of 5 stars" (one decimal, as given). */
export function starLabel(value: number): string {
  const shown = Math.round(Math.min(5, Math.max(0, value)) * 10) / 10;
  return `${shown} out of 5 star${shown === 1 ? "" : "s"}`;
}
