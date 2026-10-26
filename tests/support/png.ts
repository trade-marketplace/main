// Reads a PNG's header: size and whether it has an alpha channel. Used by the icon and share-image tests.

export type PngInfo = { width: number; height: number; hasAlpha: boolean };

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function pngInfo(bytes: Uint8Array): PngInfo {
  if (!SIGNATURE.every((b, i) => bytes[i] === b)) throw new Error("Not a PNG file.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The first chunk is IHDR: width (4 bytes), height (4), bit depth (1), colour type (1). Types 4 and 6 have alpha.
  const colourType = bytes[25];
  return { width: view.getUint32(16), height: view.getUint32(20), hasAlpha: colourType === 4 || colourType === 6 };
}
