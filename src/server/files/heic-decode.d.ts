// heic-decode ships no types. Only the part the upload service uses (#96).
declare module "heic-decode" {
  export default function decode(options: { buffer: Uint8Array }): Promise<{
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }>;
}
