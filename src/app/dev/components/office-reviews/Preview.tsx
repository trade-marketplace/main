"use client";
import { useState } from "react";
import { OfficeReviews } from "@/components/office/OfficeReviews";
import type { OfficeReview, ReviewsQuery, ReviewsPage, ReviewState, ReviewResult } from "@/lib/office/reviews";
export const reviewExamples: OfficeReview[] = [
  { id: "24200000-0000-4000-8000-000000000001", createdAt: "2026-11-12T01:00:00Z", rating: 4, comment: "The outdoor plug is working again. Jack explained what needed replacing and checked the whole circuit before leaving. He arrived in the window we agreed and left the space tidy. I would book this tradie again.", tags: ["On time", "Tidy"], customer: "Sarah T.", tradie: "Jack Wilson", jobId: "24200000-0000-4000-8000-000000000101", number: "TM-1005", reportReason: "Includes a detail that is not about this job.", hiddenAt: null, hiddenBy: null, hiddenReason: null },
  { id: "24200000-0000-4000-8000-000000000002", createdAt: "2026-11-11T01:00:00Z", rating: 5, comment: "All sorted. Thanks for the tidy work.", tags: ["Good communication"], customer: "Alex G.", tradie: "Jack Wilson", jobId: "24200000-0000-4000-8000-000000000102", number: "TM-1006", reportReason: null, hiddenAt: null, hiddenBy: null, hiddenReason: null },
  { id: "24200000-0000-4000-8000-000000000003", createdAt: "2026-11-10T01:00:00Z", rating: 2, comment: "The work took longer than I expected.", tags: [], customer: "Jo M.", tradie: "Alex Green", jobId: "24200000-0000-4000-8000-000000000103", number: "TM-1007", reportReason: null, hiddenAt: "2026-11-11T02:00:00Z", hiddenBy: "Matt Larsen", hiddenReason: "Includes private contact details." },
];
export function ReviewsPreview({ state, query }: { state: ReviewState; query: ReviewsQuery }) {
  const [changes, setChanges] = useState<Record<string, Partial<OfficeReview>>>({});
  const initial = state === "empty" ? [] : reviewExamples.map(row => ({ ...row, ...(state === "reported-empty" ? { reportReason: null } : {}), ...changes[row.id] }));
  const tab = query.tab ?? "reported", q = query.q.toLowerCase();
  const counts = { all: initial.length, reported: initial.filter(row => row.reportReason && !row.hiddenAt).length, hidden: initial.filter(row => row.hiddenAt).length };
  const rows = initial.filter(row => (tab === "all" || tab === "hidden" && row.hiddenAt || tab === "reported" && row.reportReason && !row.hiddenAt) && (!q || `${row.customer} ${row.tradie} ${row.number}`.toLowerCase().includes(q)));
  const data: ReviewsPage = { query: { ...query, tab }, counts, rows, total: rows.length };
  async function hide(id: string, reason: string): Promise<ReviewResult> { setChanges(previous => ({ ...previous, [id]: { hiddenAt: "2026-11-12T03:00:00Z", hiddenBy: "Matt Larsen", hiddenReason: reason } })); return { status: "hidden" }; }
  async function show(id: string): Promise<ReviewResult> { setChanges(previous => ({ ...previous, [id]: { hiddenAt: null, hiddenBy: null, hiddenReason: null } })); return { status: "shown" }; }
  return <OfficeReviews query={query} data={state === "error" || state === "loading" ? null : data} state={state} loading={state === "loading"} base="/dev/components/office-reviews" hide={hide} show={show} />;
}
