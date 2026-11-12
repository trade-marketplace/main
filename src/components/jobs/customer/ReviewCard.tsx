"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { SkeletonText } from "@/components/feedback/Skeleton";
import { StarRating } from "@/components/media/Stars";
import { Banner } from "@/components/overlays/Banner";
import { ToastProvider, useToast } from "@/components/overlays/Toast";
import type { AuthFailure } from "@/lib/auth/results";
import { canEditReview, reviewDate, REVIEW_LOCKED_MESSAGE, type CustomerReview, type CustomerReviewResult } from "@/lib/customer-review";
import { signoffReviewSchema, type SignoffReview } from "@/lib/customer-signoff";
import { saveReviewAction } from "@/server/jobs/customer-review-actions";
import { ReviewFields } from "./ReviewFields";
import styles from "./review-card.module.css";

export type ReviewAction = (jobId: string, input: SignoffReview) => Promise<CustomerReviewResult | AuthFailure>;
type Props = { jobId: string; data: CustomerReview | null; online: boolean; preview?: string; action?: ReviewAction; now?: number };
export function ReviewCard(props: Props) {
  return <section className={styles.card} aria-label="Your review" data-mode="customer">
    {props.preview === "loading" ? <><h2 className={styles.heading}>Your review</h2><div role="status" aria-label="Loading review"><SkeletonText lines={3} /></div></> : !props.data ? <ReviewUnavailable online={props.online} /> : <ToastProvider><ReviewEditor {...props} data={props.data} /></ToastProvider>}
  </section>;
}
function ReviewUnavailable({ online }: { online: boolean }) {
  const router = useRouter();
  return <><h2 className={styles.heading}>Your review</h2><Banner tone="alert" title="Couldn’t load your review." action={<Button variant="tertiary" disabled={!online} onClick={() => router.refresh()}>Try again</Button>} /></>;
}
function ReviewEditor({ jobId, data, online, preview, action = saveReviewAction, now }: Props & { data: CustomerReview }) {
  const router = useRouter(), session = useOptionalSessionExpired(), toast = useToast(), id = useId();
  const heading = useRef<HTMLHeadingElement>(null), edit = useRef<HTMLDivElement>(null), form = useRef<HTMLFormElement>(null), pending = useRef(false);
  const [review, setReview] = useState(data.review), [editing, setEditing] = useState(preview === "editing" || preview === "locked");
  const [rating, setRating] = useState<number | null>(data.review?.rating ?? (["stars-picked", "saving", "error", "offline"].includes(preview ?? "") ? 4 : null));
  const [tags, setTags] = useState(data.review?.tags ?? []), [comment, setComment] = useState(data.review?.comment ?? "");
  const [clock, setClock] = useState(() => now ?? Date.now()), [busy, setBusy] = useState(false), [failed, setFailed] = useState(preview === "error"), [locked, setLocked] = useState(preview === "locked"), [saved, setSaved] = useState(0);
  const saving = busy || preview === "saving", connected = online && preview !== "offline";
  const displayedReview = locked && data.review ? data.review : review;
  const editable = Boolean(displayedReview && !locked && canEditReview(displayedReview.editableUntil, clock)), fixed = locked || Boolean(editing && displayedReview && !editable), showingForm = !displayedReview || editing;
  useEffect(() => {
    if (preview || !review) return;
    const remaining = Date.parse(review.editableUntil) - Date.now();
    if (!Number.isFinite(remaining)) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.max(0, remaining + 1));
    return () => clearTimeout(timer);
  }, [preview, review]);
  function startEdit() { if (!review || !editable) return; setRating(review.rating); setTags(review.tags); setComment(review.comment ?? ""); setFailed(false); setLocked(false); setEditing(true); requestAnimationFrame(() => heading.current?.focus()); }
  function cancelEdit() { setEditing(false); setFailed(false); requestAnimationFrame(() => { const button = edit.current?.querySelector<HTMLButtonElement>("button"); if (button) button.focus(); else heading.current?.focus(); }); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || saving || !connected || fixed || rating === null) return;
    const parsed = signoffReviewSchema.safeParse({ rating, tags, comment });
    if (!parsed.success) { setFailed(true); return; }
    pending.current = true; setBusy(true); setFailed(false);
    try {
      const result = await action(jobId, parsed.data);
      if (session?.check(result)) return;
      if (!("status" in result)) { setFailed(true); return; }
      if (result.status === "saved" && result.data.review) {
        const posted = !review;
        setReview(result.data.review); setClock(now ?? Date.now()); setEditing(false); setSaved(value => value + 1);
        toast.show({ message: posted ? "Thanks. Review posted." : "Saved." });
        requestAnimationFrame(() => heading.current?.focus()); if (!preview) router.refresh();
      } else if (result.status === "locked") { setLocked(true); if (!preview) router.refresh(); }
      else setFailed(true);
    } catch { setFailed(true); }
    finally { pending.current = false; setBusy(false); }
  }
  return <>
    {showingForm && <p className={styles.eyebrow}>Your review</p>}
    <h2 className={styles.heading} tabIndex={-1} ref={heading}>{showingForm ? `How was ${data.workerFirstName}?` : "Your review"}</h2>
    {!connected && <Banner tone="alert" title="You’re offline." live />}
    {showingForm ? <form ref={form} onSubmit={submit} className={styles.form} aria-label={`Review ${data.workerFirstName}`} noValidate data-offline-queue="off">
      <fieldset disabled={saving || fixed} className={styles.fields}>
        <ReviewFields name={`review-${id}`} workerName={data.workerFirstName} rating={rating} onRating={setRating} selectedTags={tags} onTags={setTags} comment={comment} onComment={setComment} hideUntilRated starsClassName={styles.stars} tagsClassName={styles.tags} />
      </fieldset>
      {fixed && <Banner tone="info" title={REVIEW_LOCKED_MESSAGE} live />}
      {failed && <Banner tone="alert" title="Couldn’t save. Try again." live action={<Button variant="tertiary" disabled={!connected || saving} onClick={() => form.current?.requestSubmit()}>Try again</Button>} />}
      <div className={styles.actions}><Button type="submit" loading={saving} disabled={!connected || fixed || rating === null}>{review ? "Save" : "Post review"}</Button>{review && <Button variant="secondary" disabled={saving} onClick={cancelEdit}>Cancel</Button>}</div>
    </form> : displayedReview && <div className={styles.posted}>
      <StarRating value={displayedReview.rating} showValue={false} />
      {displayedReview.tags.length > 0 && <ul className={styles.postedTags} aria-label="Review tags">{displayedReview.tags.map(tag => <li key={tag}>{tag}</li>)}</ul>}
      {displayedReview.comment && <p className={styles.comment}>{displayedReview.comment}</p>}
      {editable && <><p className={styles.until}>You can change this until {reviewDate(displayedReview.editableUntil)}.</p><div className={styles.actions} ref={edit}><Button variant="tertiary" disabled={!connected} onClick={startEdit}>Edit</Button></div></>}
      {saved > 0 && <Icon key={saved} name="check_circle" fill decorative className={`${styles.saved} tm-anim-save`} />}
    </div>}
  </>;
}
