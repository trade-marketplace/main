export const OFFICE_SUPPORT_PATH = "/admin/support";
export const OFFICE_SUPPORT_PAGE_SIZE = 25;
export type OfficeSupportStatus = "open" | "closed" | "all";
export type OfficeSupportQuery = { status: OfficeSupportStatus; q: string; page: number };

export function parseOfficeSupportQuery(params: Record<string, string | string[] | undefined>): OfficeSupportQuery {
  const status = params.status === "closed" || params.status === "all" ? params.status : "open";
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const page = typeof params.page === "string" && /^\d{1,4}$/.test(params.page) ? Math.max(1, Number(params.page)) : 1;
  return { status, q, page };
}

export function officeSupportSearch(query: OfficeSupportQuery): string {
  const params = new URLSearchParams();
  if (query.status !== "open") params.set("status", query.status);
  if (query.q) params.set("q", query.q);
  if (query.page > 1) params.set("page", String(query.page));
  return params.size ? `?${params}` : "";
}

/** List state stays bounded and local; no supplied value becomes a return URL. */
export function officeSupportThreadHref(id: string, query: OfficeSupportQuery, before?: string): string {
  const params = new URLSearchParams(officeSupportSearch(query));
  if (before && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(before)) params.set("before", before);
  return `${OFFICE_SUPPORT_PATH}/${encodeURIComponent(id)}${params.size ? `?${params}` : ""}`;
}

export function officeSupportJobHref(id: string, query?: OfficeSupportQuery, threadId?: string): string {
  const params = new URLSearchParams(officeSupportSearch(query ?? { status: "open", q: "", page: 1 }));
  params.set("from", "support");
  if (threadId) params.set("supportThread", threadId);
  return `/admin/jobs/${encodeURIComponent(id)}?${params}#job-messages`;
}

export type OfficeSupportReturn = { href: string; label: "Support inbox" | "Support" };
/** Only known local routes are constructed; arbitrary return URLs are never accepted. */
export function officeSupportJobReturn(params: Record<string, string | string[] | undefined>): OfficeSupportReturn | undefined {
  if (params.from !== "support") return;
  const query = parseOfficeSupportQuery(params);
  if (typeof params.supportThread === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.supportThread)) {
    return { href: officeSupportThreadHref(params.supportThread, query), label: "Support" };
  }
  return { href: `${OFFICE_SUPPORT_PATH}${officeSupportSearch(query)}`, label: "Support inbox" };
}
