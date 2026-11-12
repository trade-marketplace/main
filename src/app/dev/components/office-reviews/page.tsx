import type { Metadata } from "next";
import { OfficeShellView } from "@/components/office/OfficeShellView";
import { REVIEW_STATES, parseReviewsQuery, type ReviewState } from "@/lib/office/reviews";
import { guardDevPage } from "@/server/dev-pages";
import { ReviewsPreview } from "./Preview";
import styles from "@/components/office/reviews.module.css";
export const metadata: Metadata = { title: "Office reviews (dev)", robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams, candidate = typeof params.state === "string" ? params.state : "reported";
  const state: ReviewState = REVIEW_STATES.includes(candidate as ReviewState) ? candidate as ReviewState : "reported";
  const defaultTab = state === "hidden" || state === "show-dialog" ? "hidden" : state === "all" || state === "empty" || state === "no-match" ? "all" : "reported";
  const query = parseReviewsQuery({ ...params, tab: params.tab ?? defaultTab, q: params.q ?? (state === "no-match" ? "Nobody" : "") });
  return <OfficeShellView viewer={{ role: "ADMIN", firstName: "Matt", lastName: "Larsen", email: "office@demo.test" }} counts={{ queues: 0, tradies: 0, support: 0 }} testMode preview={{ at: "/admin/reviews", base: "/dev/components/office-reviews" }}>{candidate === "gallery" ? <div className={styles.gallery}>{(["error", "loading", "offline"] as ReviewState[]).map(item => <article key={item} aria-label={`${item} preview`}><ReviewsPreview state={item} query={query} /></article>)}</div> : <ReviewsPreview key={`${state}:${query.tab}`} state={state} query={query} />}</OfficeShellView>;
}
