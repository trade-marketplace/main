// The support reference on the 500 page (#109): the error's digest from Next.js, which is logged on the server with
// the full error, grouped in fours so it can be read out over the phone ("1234-5678-90"). Safe on server and browser.

/** "1234567890" → "1234-5678-90". Null when there is no digest (an error that happened in the browser). */
export function errorReference(digest: string | null | undefined): string | null {
  const clean = (digest ?? "").replace(/[^0-9a-z]/gi, "").toUpperCase();
  if (!clean) return null;
  return clean.match(/.{1,4}/g)!.join("-");
}
