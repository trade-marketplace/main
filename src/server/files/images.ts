import "server-only";

import sharp from "sharp";

import { detectFileKind, type FileKind } from "./file-type";
import { MESSAGES, UploadError } from "./errors";

/** 10 MB, for photos and documents alike (#96). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Photos are shrunk to fit inside this many pixels, which also keeps us inside the Storage free tier (#59). */
export const PHOTO_MAX_EDGE = 1600;
/** Certificates and licences keep more detail so their small print stays readable. */
export const DOCUMENT_IMAGE_MAX_EDGE = 2400;
// Refuses decompression bombs: a tiny file that unpacks to billions of pixels.
const MAX_PIXELS = 100_000_000;

export type ProcessedFile = { bytes: Buffer; contentType: string; extension: string };

/** Checks size and real type, or throws an UploadError. */
export function checkUpload(input: Uint8Array, allowed: readonly FileKind[], wrongType: string): FileKind {
  if (input.length === 0) throw new UploadError("empty", MESSAGES.empty);
  if (input.length > MAX_UPLOAD_BYTES) throw new UploadError("too-large", MESSAGES.tooLarge);
  const kind = detectFileKind(input);
  if (!kind || !allowed.includes(kind)) throw new UploadError("wrong-type", wrongType);
  return kind;
}

/**
 * Turns a checked JPEG, PNG or HEIC into a WebP that fits `maxEdge`. Rotation is applied from the camera's tag
 * first, then every tag is dropped: sharp writes no EXIF, GPS or colour-profile data unless asked to, so the
 * location of a photo never reaches Storage. iPhone HEIC is decoded first because the sharp build can't read it.
 */
export async function toWebp(input: Uint8Array, kind: FileKind, maxEdge: number): Promise<ProcessedFile> {
  try {
    const source = kind === "heic" ? await decodeHeic(input) : sharp(input, { limitInputPixels: MAX_PIXELS });
    const bytes = await source
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    return { bytes, contentType: "image/webp", extension: "webp" };
  } catch (error) {
    if (error instanceof UploadError) throw error;
    throw new UploadError("unreadable", MESSAGES.unreadable);
  }
}

async function decodeHeic(input: Uint8Array) {
  const { default: decode } = await import("heic-decode");
  const image = await decode({ buffer: input });
  if (image.width * image.height > MAX_PIXELS) throw new UploadError("unreadable", MESSAGES.unreadable);
  // Raw RGBA has no metadata at all; HEIC's Exif box is never read.
  return sharp(Buffer.from(image.data), { raw: { width: image.width, height: image.height, channels: 4 } });
}
