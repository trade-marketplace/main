"use client";
import { useState } from "react";
import { TextLink } from "@/components/TextLink";
import { useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { ReviewCard, type ReviewAction } from "@/components/jobs/customer/ReviewCard";
import type { CustomerReview } from "@/lib/customer-review";
import styles from "./demo.module.css";

export function ReviewDemo({ state, now }: { state: string; now: number }) {
  const online = useOnlineStatus(), [attempt, setAttempt] = useState(0);
  const posted = ["posted-editable", "editing", "posted-fixed", "locked"].includes(state);
  const data: CustomerReview = { workerFirstName: "Jack", review: posted ? { rating: 5, tags: ["On time", "Tidy"], comment: "Great work, thank you.", editableUntil: new Date(now + (["posted-fixed", "locked"].includes(state) ? -1 : 6) * 24 * 60 * 60 * 1000).toISOString() } : null };
  const action: ReviewAction = async (_id, input) => {
    setAttempt(value => value + 1);
    if (state === "error" && attempt === 0) return { status: "unavailable" };
    return { status: "saved", data: { workerFirstName: "Jack", review: { ...input, comment: input.comment?.trim() || null, editableUntil: data.review?.editableUntil ?? new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString() } } };
  };
  return <section className={styles.page} data-mode="customer" aria-label="Review preview">
    <TextLink href="/dev/components/review-card?state=none">My jobs</TextLink>
    <div><h1 className={styles.title}>Sorted.</h1><p>Move a couch · TM-1001</p></div>
    <ReviewCard jobId="00000000-0000-4000-8000-000000000130" data={state === "load-error" ? null : data} online={online && state !== "offline"} preview={state} action={action} now={now} />
  </section>;
}
