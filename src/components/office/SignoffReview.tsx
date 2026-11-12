"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { TextLink } from "@/components/TextLink";
import { Banner } from "@/components/overlays/Banner";
import { Dialog } from "@/components/overlays/Dialog";
import { TextAreaField } from "@/components/forms/TextFields";
import { PhotoGallery } from "@/components/media/PhotoGallery";
import { OfflineBanner, useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { formatCents } from "@/components/status/PriceBlock";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import type { AuthFailure } from "@/lib/auth/results";
import { flagNote, signoffClock, type SignoffResult, type SignoffState, type SignoffView } from "@/lib/office/signoff";
import { approveEvidenceAction, flagEvidenceAction } from "@/server/office/signoff-actions";
import styles from "./signoff.module.css";
const date = (value: string | null) => value ? new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
type Reply = SignoffResult | AuthFailure;
type Props = { job: SignoffView; state?: SignoffState; now?: number; base?: string; approve?: (id: string, revision: string) => Promise<Reply>; flag?: (id: string, revision: string, note: string) => Promise<Reply> };
export function SignoffReview({ job, state, now, base = "/admin/signoff", approve = approveEvidenceAction, flag = flagEvidenceAction }: Props) {
  const router = useRouter(), session = useOptionalSessionExpired(), online = useOnlineStatus(), pending = useRef(false), lastIntent = useRef<"approve" | "flag">(state === "flag-error" ? "flag" : "approve");
  const [dialog, setDialog] = useState(state === "flag-dialog" || state === "flag-error" || state === "saving");
  const [note, setNote] = useState(""), [noteError, setNoteError] = useState<string | undefined>(), [busy, setBusy] = useState<"approve" | "flag" | null>(null);
  const [error, setError] = useState(state === "flag-error" ? "Couldn’t send this back. Try again." : ""), [result, setResult] = useState<SignoffResult["status"] | null>(state === "changed" ? "changed" : null);
  const offline = !online || state === "offline", saving = Boolean(busy) || state === "saving", checked = job.checked || result === "approved", movedOn = job.movedOn || result === "moved-on";
  async function run(kind: "approve" | "flag") {
    if (pending.current || saving || offline || checked || movedOn || result === "changed" || !job.revision) return;
    if (kind === "flag" && !flagNote(note)) { setNoteError("Enter a note between 3 and 500 characters."); return; }
    lastIntent.current = kind; pending.current = true; setBusy(kind); setError(""); setNoteError(undefined);
    try {
      const reply = await (kind === "approve" ? approve(job.id, job.revision) : flag(job.id, job.revision, note));
      if (session?.check(reply)) return;
      if (!("status" in reply)) { setError("Couldn’t save this check. Try again."); return; }
      if (reply.status === "flagged") { router.push(base.startsWith("/dev/") ? `${base}?state=list&sent=1` : `${base}?sent=${encodeURIComponent(job.worker)}`); return; }
      if (reply.status === "invalid") setNoteError("Enter a note between 3 and 500 characters.");
      else if (["approved", "changed", "moved-on"].includes(reply.status)) { setResult(reply.status); setDialog(false); if (reply.status === "approved") router.refresh(); }
      else setError("Couldn’t save this check. Try again.");
    } catch { setError("Couldn’t save this check. Try again."); } finally { pending.current = false; setBusy(null); }
  }
  return <section className={styles.page} data-mode="office"><nav aria-label="Breadcrumb" className={styles.breadcrumbs}><TextLink href={base}>Sign-off / CoC review</TextLink><span>{job.number}</span></nav><header className={styles.header}><p className={styles.muted}>{job.number} · {job.trade}</p><h1>{job.title}</h1><p className={styles.muted}>{job.customer} · {job.worker}</p><p className={styles.muted}>{signoffClock(job.sentAt, job.hours, job.problem, now ?? job.loadedAt)}</p></header><OfflineBanner online={state === "offline" ? false : undefined} sticky={false} />
    {movedOn && <Banner tone="info" action={<TextLink href={`/admin/jobs/${job.id}`}>Open job</TextLink>}>This job has moved on.</Banner>}
    {result === "changed" && <Banner tone="alert" action={<Button onClick={() => router.refresh()}>Try again</Button>}>This evidence has changed. Reload before checking.</Banner>}
    {checked && <Banner tone="good">Checked by {job.checkedBy && job.checkedBy !== "—" ? job.checkedBy : result === "approved" ? "you" : "—"}, {date(job.checkedAt ?? new Date().toISOString())}.</Banner>}
    {job.filesUnavailable && <Banner tone="alert" action={<Button onClick={() => router.refresh()}>Try again</Button>}>Files aren’t available right now. Try again.</Banner>}
    {error && !dialog && <Banner tone="alert" live action={<Button disabled={offline || saving} onClick={() => lastIntent.current === "flag" ? setDialog(true) : void run("approve")}>Try again</Button>}>{error}</Banner>}
    <div className={styles.grid}><section className={styles.card} aria-label="Completion evidence"><h2>Evidence</h2><dl className={styles.facts}>{job.cocNumber && <div><dt>CoC number</dt><dd>{job.cocNumber}</dd></div>}{job.cocUrl && <div><dt>CoC document</dt><dd><TextLink href={job.cocUrl} external>Open</TextLink></dd></div>}</dl>{job.photos.length ? <PhotoGallery photos={job.photos.map((photo, index) => ({ src: photo.url, alt: `Finished work photo ${index + 1}` }))} label="Finished work" /> : <p>No photos added.</p>}<h2>Notes</h2><p className={styles.notice}>{job.notes || "—"}</p><h2>Declaration</h2><p>{job.declaration || "—"}</p><p className={styles.muted}>{date(job.declaredAt)}</p></section><section className={styles.card} aria-label="Materials"><h2>Materials</h2><dl className={styles.facts}><div><dt>Budget</dt><dd>{formatCents(job.budgetCents)}</dd></div><div><dt>Spend</dt><dd>{job.spentCents === null ? "—" : formatCents(job.spentCents)}</dd></div>{job.receiptUrl && <div><dt>Receipt</dt><dd><TextLink href={job.receiptUrl} external>Open</TextLink></dd></div>}</dl>{job.spentCents !== null && job.spentCents > job.budgetCents && <Banner tone="alert">Over budget by {formatCents(job.spentCents - job.budgetCents)}{job.overBudgetReason && <p className={styles.notice}>{job.overBudgetReason}</p>}</Banner>}</section></div>
    {!checked && !movedOn && <div className={styles.actions}><Button loading={busy === "approve"} disabled={offline || saving || result === "changed" || !job.sentAt || job.filesUnavailable} onClick={() => void run("approve")}>Approve</Button><Button variant="secondary" disabled={offline || saving || result === "changed" || !job.sentAt} onClick={() => setDialog(true)}>Flag</Button></div>}
    <Dialog open={dialog} title="Send back to tradie" dismissible={!saving} onClose={() => { if (!saving) setDialog(false); }} footer={<><Button variant="secondary" disabled={saving} onClick={() => setDialog(false)}>Not now</Button><Button variant="destructive" loading={busy === "flag" || state === "saving"} disabled={offline || saving} onClick={() => void run("flag")}>Send back to tradie</Button></>}><TextAreaField label="Note for the tradie" name="note" required value={note} maxLength={500} disabled={saving} error={noteError} onChange={event => { setNote(event.target.value); setNoteError(undefined); }} />{error && <Banner tone="alert" live>{error}</Banner>}</Dialog>
  </section>;
}
