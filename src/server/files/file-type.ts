// Works out what a file really is from its first bytes (#96). The name and the browser's content type are chosen by
// whoever uploads, so a script renamed to photo.jpg would sail through if we trusted them.

export type FileKind = "jpeg" | "png" | "heic" | "pdf";

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);

/** The real type of these bytes, or null when it isn't a JPEG, PNG, HEIC/HEIF or PDF. */
export function detectFileKind(bytes: Uint8Array): FileKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)
  ) {
    return "png";
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp" && HEIC_BRANDS.has(ascii(bytes, 8, 12))) return "heic";
  // The PDF spec allows up to 1024 bytes of junk before the header.
  if (ascii(bytes, 0, Math.min(bytes.length, 1024)).includes("%PDF-")) return "pdf";
  return null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return Buffer.from(bytes.subarray(start, end)).toString("latin1");
}
