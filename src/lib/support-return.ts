/** Help can return only to its own article/search, never to a caller-supplied destination. */
export function supportReturn(value: unknown, fallback: "/help" | "/support" = "/help"): string {
  if (typeof value !== "string" || value.length > 700 || /[\\#\u0000-\u0020]/.test(value)) return fallback;
  try {
    const url = new URL(value, "https://help.invalid");
    if (url.origin !== "https://help.invalid" || !value.startsWith("/") || !/^\/(?:support(?:\/articles\/[a-z0-9]+(?:-[a-z0-9]+)*)?|help(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?)$/.test(url.pathname)) return fallback;
    if ([...url.searchParams.keys()].some(key => !["q", "topic", "page"].includes(key)) || [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1)) return fallback;
    const q = url.searchParams.get("q"), topic = url.searchParams.get("topic"), page = url.searchParams.get("page");
    if ((q && q.length > 200) || (topic && !/^[a-z-]{1,80}$/.test(topic)) || (page && !/^[1-9]\d{0,5}$/.test(page))) return fallback;
    return url.pathname + url.search;
  } catch { return fallback; }
}
export const supportThreadHref = (id: string, returnTo = "/help", before?: string) => `/support/${encodeURIComponent(id)}?returnTo=${encodeURIComponent(supportReturn(returnTo))}${before ? `&before=${encodeURIComponent(before)}` : ""}`;
