import type { Metadata } from "next";
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { OfficeReviews } from "@/components/office/OfficeReviews";
import { parseReviewsQuery, reviewsHref, type ReviewsPage } from "@/lib/office/reviews";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { listReviews } from "@/server/office/reviews";
export const metadata: Metadata = { title: "Reviews" };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseReviewsQuery(await searchParams), viewer = await requireRole(["ADMIN"], { next: reviewsHref(query) });
  let data: ReviewsPage | null = null;
  try { data = await listReviews(getDb(), viewer, query); if (!data) notFound(); }
  catch (error) { unstable_rethrow(error); }
  // A concrete URL keeps the chosen default tab after the last reported review is hidden.
  if (data && query.tab === null) redirect(reviewsHref(data.query));
  return <OfficeReviews query={data?.query ?? query} data={data} />;
}
