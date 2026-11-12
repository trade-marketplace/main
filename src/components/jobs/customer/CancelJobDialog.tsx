"use client";
import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { TextAreaField } from "@/components/forms/TextFields";
import { Banner } from "@/components/overlays/Banner";
import { Dialog } from "@/components/overlays/Dialog";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import type { AuthFailure } from "@/lib/auth/results";
import { cancelReasonSchema, CANCEL_REQUESTED_MESSAGE, type CancelFacts, type CancelResult } from "@/lib/customer-cancel";
import { cancelJobAction } from "@/server/jobs/customer-cancel-actions";
import styles from "./cancel-job.module.css";

export type CancelAction = (id: string, revision: string, reason?: string) => Promise<CancelResult | AuthFailure>;
type Props = { jobId: string; revision: string; facts: CancelFacts; online: boolean; preview?: string; action?: CancelAction; onCancelled?: () => void; onEditing?: () => void };
export function CancelJobDialog({ jobId, revision, facts, online, preview, action = cancelJobAction, onCancelled, onEditing }: Props) {
  const router = useRouter(), session = useOptionalSessionExpired(), formId = useId(), field = useRef<HTMLTextAreaElement>(null), form = useRef<HTMLFormElement>(null), pending = useRef(false);
  const [open, setOpen] = useState(Boolean(preview && !["closed", "requested", "cancelled", "empty", "loading"].includes(preview)));
  const [openedRevision, setOpenedRevision] = useState(revision);
  const [reason, setReason] = useState(["saving", "error"].includes(preview ?? "") ? "The work is no longer needed." : "");
  const [error, setError] = useState<string | null>(preview === "reason-error" ? "Tell us why." : null);
  const [failed, setFailed] = useState(preview === "error"), [changed, setChanged] = useState(preview === "changed"), [busy, setBusy] = useState(false);
  const [result, setResult] = useState(preview === "requested" ? "requested" : preview === "cancelled" ? "cancelled" : "");
  const saving = busy || preview === "saving", connected = online && preview !== "offline";
  function close() { if (!pending.current) { setOpen(false); if (changed) router.refresh(); } }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !connected || changed || saving) return;
    if (facts.paid) {
      const parsed = cancelReasonSchema.safeParse(reason);
      if (!parsed.success) { setError(parsed.error.issues[0].message); requestAnimationFrame(() => field.current?.focus()); return; }
    }
    pending.current = true; setBusy(true); setFailed(false); setError(null);
    try {
      const answer = await action(jobId, openedRevision, facts.paid ? reason : undefined);
      if (session?.check(answer)) return;
      if (!("status" in answer)) { setFailed(true); return; }
      if (answer.status === "cancelled" || answer.status === "requested") { setResult(answer.status); setOpen(false); onCancelled?.(); router.refresh(); }
      else if (answer.status === "invalid") { setError(answer.reason); requestAnimationFrame(() => field.current?.focus()); }
      else if (answer.status === "changed" || answer.status === "forbidden") setChanged(true);
      else setFailed(true);
    } catch { setFailed(true); }
    finally { pending.current = false; setBusy(false); }
  }
  if (result) return <Banner tone="info" title={result === "requested" ? CANCEL_REQUESTED_MESSAGE : "This job was cancelled."} live className={styles.notice} />;
  if (!facts.canCancel) return null;
  return <>
    <Button variant="tertiary" disabled={!connected} onClick={() => { onEditing?.(); setOpenedRevision(revision); setReason(""); setError(null); setFailed(false); setChanged(false); setOpen(true); }}>Cancel job</Button>
    <Dialog open={open} title="Cancel this job?" role="alertdialog" size="sm" onClose={close} dismissible={!saving}
      footer={<><Button variant="secondary" disabled={saving} onClick={close}>Keep job</Button><Button variant="destructive" type="submit" form={formId} loading={saving} disabled={!connected || changed}>{facts.paid ? "Request to cancel" : "Cancel job"}</Button></>}>
      <div className={styles.body}>
        <p>{facts.paid ? `You’ve already paid, so we’ll check${facts.workerFirstName ? ` with ${facts.workerFirstName}` : ""} before refunding. We’ll reply within 1 working day.` : "It’s free to cancel."}</p>
        {facts.paid && facts.onTheWay && facts.workerFirstName && <Banner tone="alert" title={`${facts.workerFirstName} is already on the way. A call-out fee may apply.`} />}
        {!connected && <Banner tone="alert" title="You’re offline." live />}
        {changed && <Banner tone="info" title="Job updated" live>Close this dialog to see the latest details.</Banner>}
        {failed && <Banner tone="alert" title="Couldn’t cancel the job." live action={<Button variant="tertiary" disabled={!connected || saving} onClick={() => form.current?.requestSubmit()}>Try again</Button>} />}
        <form ref={form} id={formId} onSubmit={send} noValidate data-offline-queue="off">
          {facts.paid && <TextAreaField ref={field} label="Reason" name="reason" value={reason} required maxLength={500} disabled={saving || changed} error={error ?? undefined} onChange={event => setReason(event.target.value)} />}
        </form>
      </div>
    </Dialog>
  </>;
}
