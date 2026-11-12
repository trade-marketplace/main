"use client";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { TextLink } from "@/components/TextLink";
import { DataTable, FilterBar, Pagination, Tabs, type Column } from "@/components/data";
import { EmptyState, ErrorState } from "@/components/feedback";
import { OfflineBanner, useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { TextAreaField } from "@/components/forms/TextFields";
import { Dialog } from "@/components/overlays/Dialog";
import { Banner } from "@/components/overlays/Banner";
import { StarRating } from "@/components/media/Stars";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import type { AuthFailure } from "@/lib/auth/results";
import { moderationReason, reviewsHref, REVIEW_PAGE_SIZE, type OfficeReview, type ReviewsPage, type ReviewsQuery, type ReviewResult, type ReviewState } from "@/lib/office/reviews";
import { hideReviewAction, showReviewAction } from "@/server/office/review-actions";
import styles from "./reviews.module.css";
const when = (value: string) => new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", dateStyle: "medium" }).format(new Date(value));
function ReviewComment({ text }: { text: string | null }) {
  const [expanded, setExpanded] = useState(false), [clipped, setClipped] = useState(false), ref = useRef<HTMLParagraphElement>(null), id = useId();
  useEffect(() => {
    if (expanded) return;
    let active = true;
    const check = () => { if (active && ref.current) setClipped(ref.current.scrollHeight > ref.current.clientHeight + 1); };
    const frame = requestAnimationFrame(check), observer = new ResizeObserver(check);
    if (ref.current) observer.observe(ref.current);
    void document.fonts.ready.then(check);
    return () => { active = false; cancelAnimationFrame(frame); observer.disconnect(); };
  }, [text, expanded]);
  return <div className={styles.comment}><p id={id} ref={ref} className={expanded ? undefined : styles.clamped}>{text || "—"}</p>{clipped && <Button variant="tertiary" size="sm" width="auto" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>{expanded ? "Show less" : "Show more"}</Button>}</div>;
}
type Reply = ReviewResult | AuthFailure;
type Props = { query: ReviewsQuery; data: ReviewsPage | null; base?: string; state?: ReviewState; loading?: boolean; hide?: (id: string, reason: string) => Promise<Reply>; show?: (id: string) => Promise<Reply> };
export function OfficeReviews({ query, data, base = "/admin/reviews", state, loading = false, hide = hideReviewAction, show = showReviewAction }: Props) {
  const router = useRouter(), session = useOptionalSessionExpired(), online = useOnlineStatus(), [pending, startTransition] = useTransition();
  const initial = state === "show-dialog" ? "show" : state === "hide-dialog" || state === "reason-error" || state === "saving" ? "hide" : null;
  const [dialog, setDialog] = useState<{ row: OfficeReview; kind: "hide" | "show" } | null>(() => initial && data?.rows[0] ? { row: data.rows[0], kind: initial } : null);
  const [reason, setReason] = useState(state === "saving" ? "Includes private contact details." : ""), [reasonError, setReasonError] = useState<string | undefined>(state === "reason-error" ? "Enter a reason between 3 and 500 characters." : undefined), [error, setError] = useState(""), [busy, setBusy] = useState(false), submitting = useRef(false);
  const [q, setQ] = useState(query.q), [lastQ, setLastQ] = useState(query.q), latest = useRef(query), typed = useRef(false);
  if (query.q !== lastQ) { setLastQ(query.q); setQ(query.q); }
  useEffect(() => { latest.current = query; }, [query]);
  const offline = !online || state === "offline", saving = busy || state === "saving";
  function go(next: Partial<ReviewsQuery>, replace = false) {
    latest.current = { ...latest.current, page: 1, ...next };
    startTransition(() => (replace ? router.replace : router.push)(reviewsHref(latest.current, base), { scroll: false }));
  }
  useEffect(() => {
    if (!typed.current || q.trim() === latest.current.q) return;
    const timer = setTimeout(() => go({ q: q.trim() }, true), 300);
    return () => clearTimeout(timer);
    // Only live typing starts a search; go uses the latest URL state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  function open(row: OfficeReview, kind: "hide" | "show") { setReason(""); setReasonError(undefined); setError(""); setDialog({ row, kind }); }
  function close() { if (saving) return; setDialog(null); setError(""); }
  async function submit() {
    if (!dialog || submitting.current || saving || offline) return;
    if (dialog.kind === "hide" && !moderationReason(reason)) { setReasonError("Enter a reason between 3 and 500 characters."); return; }
    submitting.current = true; setBusy(true); setError(""); setReasonError(undefined);
    try {
      const reply = await (dialog.kind === "hide" ? hide(dialog.row.id, reason) : show(dialog.row.id));
      if (session?.check(reply)) return;
      if (!("status" in reply)) { setError("Couldn’t save this review. Try again."); return; }
      if (reply.status === "hidden" || reply.status === "shown") { setDialog(null); startTransition(() => router.refresh()); }
      else if (reply.status === "invalid") setReasonError("Enter a reason between 3 and 500 characters.");
      else setError("Couldn’t save this review. Try again.");
    } catch { setError("Couldn’t save this review. Try again."); } finally { submitting.current = false; setBusy(false); }
  }
  const columns: Column<OfficeReview>[] = [
    { key: "date", header: "Date", optional: true, nowrap: true, cell: row => <time dateTime={row.createdAt}>{when(row.createdAt)}</time> },
    { key: "stars", header: "Stars", nowrap: true, cell: row => <StarRating value={row.rating} size="sm" showValue={false} /> },
    { key: "comment", header: "Comment", primary: true, cell: row => <div className={styles.comment}><ReviewComment text={row.comment} />{row.reportReason && <p className={styles.context}><b>Report reason: </b>{row.reportReason}</p>}{row.hiddenAt && <p className={styles.context}>Hidden by {row.hiddenBy || "—"}, {when(row.hiddenAt)}: {row.hiddenReason}</p>}</div> },
    { key: "tags", header: "Tags", optional: true, cell: row => row.tags.length ? <div className={styles.tags}>{row.tags.map((tag, index) => <span key={`${tag}-${index}`} className={styles.tag}>{tag}</span>)}</div> : "—" },
    { key: "customer", header: "Customer", optional: true, cell: row => row.customer },
    { key: "tradie", header: "Tradie", optional: true, cell: row => <TextLink href="/admin/tradies">{row.tradie}</TextLink> },
    { key: "job", header: "Job", nowrap: true, cell: row => <TextLink href={`/admin/jobs/${row.jobId}`}>{row.number}</TextLink> },
  ];
  const active = data?.query.tab ?? query.tab ?? "all", counts = data?.counts;
  return <section className={styles.page} data-mode="office"><h1 className={styles.title}>Reviews</h1><OfflineBanner online={state === "offline" ? false : undefined} sticky={false} />
    <FilterBar label="Filter reviews" search={{ label: "Search reviews", placeholder: "Search", value: q, onChange: value => { typed.current = true; setQ(value); } }} filters={[]} values={{}} onChange={() => {}} onClear={() => { typed.current = false; setQ(""); go({ q: "" }); }} />
    <Tabs label="Review tabs" value={active} items={[{ value: "reported", label: "Reported", count: counts?.reported }, { value: "all", label: "All", count: counts?.all }, { value: "hidden", label: "Hidden", count: counts?.hidden }]} onChange={tab => go({ tab })}>
      <DataTable caption="Reviews" columns={columns} rows={data?.rows ?? []} rowId={row => row.id} rowLabel={row => `${row.customer} review`} loading={loading || pending} loadingLabel="Loading reviews"
        rowActions={row => <Button variant="secondary" size="sm" disabled={offline || saving} onClick={() => open(row, row.hiddenAt ? "show" : "hide")}>{row.hiddenAt ? "Show again" : "Hide"}</Button>}
        error={!data && !loading ? <ErrorState title="Couldn’t load reviews" message="Try again." onRetry={() => startTransition(() => router.refresh())} headingLevel={2} /> : undefined}
        empty={<EmptyState icon="star" title={query.q ? "No reviews match that." : active === "reported" ? "Nothing reported." : "No reviews yet."} headingLevel={2} action={query.q ? <Button variant="secondary" onClick={() => { typed.current = false; setQ(""); go({ q: "" }); }}>Clear search</Button> : undefined} />}
        footer={data && data.total > 0 ? <Pagination label="Reviews" page={data.query.page} pageSize={REVIEW_PAGE_SIZE} total={data.total} getHref={page => reviewsHref({ ...query, page }, base)} /> : undefined} />
    </Tabs>
    <Dialog open={dialog?.kind === "hide"} title="Hide this review?" onClose={close} dismissible={!saving} footer={<><Button variant="secondary" disabled={saving} onClick={close}>Keep</Button><Button variant="destructive" loading={saving} disabled={offline || saving} onClick={() => void submit()}>Hide review</Button></>}><p>It won’t show publicly or count in the rating.</p><TextAreaField label="Reason" name="reason" required maxLength={500} value={reason} error={reasonError} disabled={saving} onChange={event => { setReason(event.target.value); setReasonError(undefined); }} />{error && <Banner tone="alert" live>{error}</Banner>}</Dialog>
    <Dialog open={dialog?.kind === "show"} role="alertdialog" title="Show this review again?" onClose={close} dismissible={!saving} footer={<><Button variant="secondary" disabled={saving} onClick={close}>Keep hidden</Button><Button loading={saving} disabled={offline || saving} onClick={() => void submit()}>Show again</Button></>}>{error && <Banner tone="alert" live>{error}</Banner>}</Dialog>
  </section>;
}
