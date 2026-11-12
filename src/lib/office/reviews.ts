export const REVIEW_TABS = ["reported", "all", "hidden"] as const;
export type ReviewTab = typeof REVIEW_TABS[number];
export const REVIEW_PAGE_SIZE = 25;
export const REVIEW_STATES = ["reported", "all", "hidden", "hide-dialog", "reason-error", "saving", "show-dialog", "empty", "reported-empty", "no-match", "error", "loading", "offline"] as const;
export type ReviewState = typeof REVIEW_STATES[number];
export type ReviewsQuery = { tab: ReviewTab | null; q: string; page: number };
export type OfficeReview = {
  id: string; createdAt: string; rating: number; comment: string | null; tags: string[];
  customer: string; tradie: string; jobId: string; number: string; reportReason: string | null;
  hiddenAt: string | null; hiddenBy: string | null; hiddenReason: string | null;
};
export type ReviewsPage = { query: ReviewsQuery & { tab: ReviewTab }; rows: OfficeReview[]; total: number; counts: Record<ReviewTab, number> };
export type ReviewResult = { status: "hidden" | "shown" | "invalid" | "forbidden" | "unavailable" };
export function parseReviewsQuery(params: Record<string, string | string[] | undefined>): ReviewsQuery {
  const one = (name: string) => { const value = params[name]; return (Array.isArray(value) ? value[0] : value)?.trim() ?? ""; };
  const tab = one("tab"), page = Number(one("page"));
  return { tab: REVIEW_TABS.includes(tab as ReviewTab) ? tab as ReviewTab : null, q: one("q").slice(0, 80), page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 1000000) : 1 };
}
export function reviewsHref(query: ReviewsQuery, base = "/admin/reviews") {
  const params = new URLSearchParams();
  if (base.startsWith("/dev/")) params.set("state", query.tab ?? "reported");
  if (query.tab) params.set("tab", query.tab);
  if (query.q) params.set("q", query.q);
  if (query.page > 1) params.set("page", String(query.page));
  return `${base}${params.size ? `?${params}` : ""}`;
}
export const moderationReason = (reason: unknown) => typeof reason === "string" && reason.trim().length >= 3 && reason.trim().length <= 500 ? reason.trim() : null;
export const reviewCustomerName = (person: { firstName: string; lastName: string | null }) => `${person.firstName}${person.lastName?.trim() ? ` ${Array.from(person.lastName.trim())[0]}.` : ""}`;
