// Serves the public email logo on assets.trademarketplace.nz. The deployment
// appends `export default createEmailAssetWorker(base64Png, sha256)` to this file.
// Only immutable public image data is held across requests; there is no upstream
// fetch, credential, tracking URL, user input proxy or storage binding.
export function createEmailAssetWorker(encoded, digest) {
  if (!/^[a-f0-9]{64}$/.test(digest) || encoded.length > 65_536) {
    throw new TypeError("Invalid email logo deployment");
  }
  const image = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  const pathname = `/email/trade-marketplace-${digest.slice(0, 12)}.png`;
  const etag = `"${digest}"`;

  return {
    fetch(request) {
      if (new URL(request.url).pathname !== pathname) {
        return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      }
      const headers = {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        ETag: etag,
      };
      if (request.headers.get("If-None-Match") === etag) {
        return new Response(null, { status: 304, headers });
      }
      headers["Content-Length"] = String(image.byteLength);
      return new Response(request.method === "HEAD" ? null : image, { headers });
    },
  };
}
