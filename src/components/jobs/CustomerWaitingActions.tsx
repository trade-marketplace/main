"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { TextAreaField, TextField } from "@/components/forms/TextFields";
import { Banner } from "@/components/overlays/Banner";
import { Dialog } from "@/components/overlays/Dialog";
import type { AuthFailure } from "@/lib/auth/results";
import { customerJobDetailsSchema, waitingJobRevision, type CustomerJobDetails, type WaitingJobResult } from "@/lib/customer-job-waiting";
import { saveWaitingJobAction } from "@/server/jobs/customer-waiting-actions";
import type { CustomerJobView } from "@/server/views";
import { CancelJobDialog, type CancelAction } from "./customer/CancelJobDialog";
import { cancelRevision, type CancelFacts } from "@/lib/customer-cancel";
import styles from "./customer-job.module.css";

export type WaitingActions = {
  save: (id: string, revision: string, input: CustomerJobDetails) => Promise<WaitingJobResult | AuthFailure>;
  cancel: (id: string, revision: string) => Promise<WaitingJobResult | AuthFailure>;
};
export function WaitingIssueNotice({ kind }: { kind: "edit" | "cancel" | "changed" }) {
  return <Banner tone={kind === "changed" ? "info" : "alert"} title={kind === "changed" ? "Job updated" : kind === "cancel" ? "Couldn’t cancel the job." : "Couldn’t save."} live className={styles.notice}>{kind === "changed" ? "Close this dialog to see the latest details." : null}</Banner>;
}
export function CustomerWaitingActions({ job, online, preview, actions, onCancelled, cancelFacts, cancelAction }: { job: CustomerJobView; online: boolean; preview?: string; actions?: WaitingActions; onCancelled?: () => void; cancelFacts?: CancelFacts | null; cancelAction?: CancelAction }) {
  const router = useRouter(), session = useOptionalSessionExpired(), formId = useId();
  const pending = useRef(false), form = useRef<HTMLFormElement>(null);
  const values = () => ({ title: job.title, description: job.description, accessNotes: job.address.accessNotes ?? "" });
  const [draft, setDraft] = useState(() => preview === "invalid" ? { ...values(), description: "" } : values());
  // A reconnect may refresh the frame while this dialog is open. It must not advance the draft's revision.
  const [revision, setRevision] = useState(() => waitingJobRevision(job.updatedAt, values()));
  const [dialog, setDialog] = useState<"edit" | null>(["edit", "invalid", "saving", "error", "changed"].includes(preview ?? "") ? "edit" : null);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(preview === "error" || preview === "cancel-error");
  const [changed, setChanged] = useState(preview === "changed"), [saved, setSaved] = useState(preview === "success");
  const [fields, setFields] = useState<Partial<Record<keyof CustomerJobDetails, string>>>(preview === "invalid" ? { description: "Describe the job" } : {});
  const saving = busy || preview === "saving";
  function open(next: "edit") { setDraft(values()); setRevision(waitingJobRevision(job.updatedAt, values())); setFields({}); setFailed(false); setChanged(false); setDialog(next); }
  function close() { if (!pending.current) { setDialog(null); if (changed) router.refresh(); } }
  async function run() {
    if (pending.current || !online || changed || saving) return;
    {
      const parsed = customerJobDetailsSchema.safeParse(draft);
      if (!parsed.success) {
        setFields(Object.fromEntries(parsed.error.issues.map(issue => [issue.path[0], issue.message])));
        requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
        return;
      }
    }
    pending.current = true; setBusy(true); setFailed(false);
    try {
      const result = await (actions?.save ?? saveWaitingJobAction)(job.id, revision, draft);
      if (session?.check(result)) return;
      if (!("status" in result)) { setFailed(true); return; }
      if (result.status === "saved" || result.status === "cancelled") { if (result.status === "cancelled") onCancelled?.(); setDialog(null); setSaved(result.status === "saved"); router.refresh(); }
      else if (result.status === "changed" || result.status === "forbidden") setChanged(true);
      else if (result.status === "invalid") { setFields(result.fields); requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); }
      else setFailed(true);
    } catch { setFailed(true); }
    finally { pending.current = false; setBusy(false); }
  }
  const legacyCancel: CancelAction | undefined = actions ? async () => {
    const answer = await actions.cancel(job.id, waitingJobRevision(job.updatedAt, values()));
    if (!("status" in answer)) return answer;
    return { status: answer.status === "saved" || answer.status === "invalid" ? "unavailable" : answer.status };
  } : undefined;
  function submit(event: FormEvent) { event.preventDefault(); void run(); }
  return <div className={styles.waitingActions}>
    {saved && <Banner tone="good" title="Saved." live className={styles.notice} />}
    <div className={styles.actionRow}>
      <Button variant="secondary" disabled={!online} onClick={() => open("edit")}>Edit job</Button>
      {cancelFacts !== null && <CancelJobDialog jobId={job.id} revision={cancelRevision(job.updatedAt, job.status)} facts={cancelFacts ?? { canCancel: job.status === "REVIEW", paid: false, workerFirstName: null, onTheWay: false }} online={online} preview={preview?.startsWith("cancel") ? preview === "cancel-error" ? "error" : "free" : undefined} action={cancelAction ?? legacyCancel} onCancelled={onCancelled} onEditing={() => setDialog(null)} />}
    </div>
    <Dialog open={dialog !== null} title="Edit job" onClose={close} dismissible={!saving}
      footer={<><Button variant="secondary" disabled={saving} onClick={close}>Not now</Button><Button variant="primary" type="submit" form={formId} loading={saving} disabled={!online || changed}>Save changes</Button></>}>
      <div className={styles.editBody}>
        {!online && <Banner tone="alert" title="You’re offline." live className={styles.notice} />}
        {failed && <WaitingIssueNotice kind="edit" />}
        {changed && <WaitingIssueNotice kind="changed" />}
        <form id={formId} ref={form} onSubmit={submit} noValidate data-offline-queue="off" className={styles.editForm}>
          <TextField label="Job title" name="title" value={draft.title} maxLength={200} required disabled={saving || changed} error={fields.title} onChange={event => setDraft({ ...draft, title: event.target.value })} />
          <TextAreaField label="Describe the job" name="description" value={draft.description} maxLength={1000} required disabled={saving || changed} error={fields.description} onChange={event => setDraft({ ...draft, description: event.target.value })} />
          <TextAreaField label="Anything else? (optional)" name="accessNotes" value={draft.accessNotes} maxLength={1000} disabled={saving || changed} error={fields.accessNotes} onChange={event => setDraft({ ...draft, accessNotes: event.target.value })} />
        </form>
      </div>
    </Dialog>
  </div>;
}
