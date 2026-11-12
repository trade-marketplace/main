export type SavedCustomerReview = { rating: number; tags: string[]; comment: string | null; editableUntil: string };
export type CustomerReview = { workerFirstName: string; review: SavedCustomerReview | null };
export type CustomerReviewResult = { status: "saved"; data: CustomerReview } | { status: "forbidden" | "invalid" | "locked" | "unavailable" };
export const REVIEW_LOCKED_MESSAGE = "This review can’t be changed now.";
export const canEditReview = (until: string, now = Date.now()) => Number.isFinite(Date.parse(until)) && Date.parse(until) > now;
const date = new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", weekday: "short", day: "numeric", month: "short" });
export const reviewDate = (until: string) => date.formatToParts(new Date(until)).filter(part => ["weekday", "day", "month"].includes(part.type)).map(part => part.value).join(" ");
