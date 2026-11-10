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
import { saveWaitingJobAction, cancelWaitingJobAction } from "@/server/jobs/customer-waiting-actions";
import type { CustomerJobView } from "@/server/views";
import styles from "./customer-job.module.css";

export type WaitingActions = {
  save: (id: string, revision: string, input: CustomerJobDetails) => Promise<WaitingJobResult | AuthFailure>;
  cancel: (id: string, revision: string) => Promise<WaitingJobResult | AuthFailure>;
};
export function WaitingIssueNotice({ kind }: { kind: "edit" | "cancel" | "changed" }) {
  return <Banner tone={kind === "changed" ? "info" : "alert"} title={kind === "changed" ? "Job updated" : kind === "cancel" ? "Couldn’t cancel the job." : "Couldn’t save."} live className={styles.notice}>{kind === "changed" ? "Close this dialog to see the latest details." : null}</Banner>;
}
export function CustomerWaitingActions({ job, online, preview, actions, onCancelled }: { job: CustomerJobView; online: boolean; preview?: string; actions?: WaitingActions; onCancelled?: () => void }) {
  const router = useRouter(), session = useOptionalSessionExpired(), formId = useId();
  const pending = useRef(false), form = useRef<HTMLFormElement>(null);
  const values = () => ({ title: job.title, description: job.description, accessNotes: job.address.accessNotes ?? "" });
  const [draft, setDraft] = useState(() => preview === "invalid" ? { ...values(), description: "" } : values());
  // A reconnect may refresh the frame while this dialog is open. It must not advance the draft's revision.
  const [revision, setRevision] = useState(() => waitingJobRevision(job.updatedAt, values()));
  const [dialog, setDialog] = useState<"edit" | "cancel" | null>(preview?.startsWith("cancel") ? "cancel" : ["edit", "invalid", "saving", "error", "changed"].includes(preview ?? "") ? "edit" : null);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(preview === "error" || preview === "cancel-error");
  const [changed, setChanged] = useState(preview === "changed"), [saved, setSaved] = useState(preview === "success");
  const [fields, setFields] = useState<Partial<Record<keyof CustomerJobDetails, string>>>(preview === "invalid" ? { description: "Describe the job" } : {});
  const saving = busy || preview === "saving";
  function open(next: "edit" | "cancel") { setDraft(values()); setRevision(waitingJobRevision(job.updatedAt, values())); setFields({}); setFailed(false); setChanged(false); setDialog(next); }
  function close() { if (!pending.current) { setDialog(null); if (changed) router.refresh(); } }
  async function run(command: "edit" | "cancel") {
    if (pending.current || !online || changed || saving) return;
    if (command === "edit") {
      const parsed = customerJobDetailsSchema.safeParse(draft);
      if (!parsed.success) {
        setFields(Object.fromEntries(parsed.error.issues.map(issue => [issue.path[0], issue.message])));
        requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
        return;
      }
    }
    pending.current = true; setBusy(true); setFailed(false);
    try {
      const result = command === "edit" ? await (actions?.save ?? saveWaitingJobAction)(job.id, revision, draft) : await (actions?.cancel ?? cancelWaitingJobAction)(job.id, revision);
      if (session?.check(result)) return;
      if (!("status" in result)) { setFailed(true); return; }
      if (result.status === "saved" || result.status === "cancelled") { if (result.status === "cancelled") onCancelled?.(); setDialog(null); setSaved(result.status === "saved"); router.refresh(); }
      else if (result.status === "changed" || result.status === "forbidden") setChanged(true);
      else if (result.status === "invalid") { setFields(result.fields); requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); }
      else setFailed(true);
    } catch { setFailed(true); }
    finally { pending.current = false; setBusy(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void run("edit"); }
  return <div className={styles.waitingActions}>
    {saved && <Banner tone="good" title="Saved." live className={styles.notice} />}
    <div className={styles.actionRow}>
      <Button variant="secondary" disabled={!online} onClick={() => open("edit")}>Edit job</Button>
      {job.status === "REVIEW" && <Button variant="tertiary" disabled={!online} onClick={() => open("cancel")}>Cancel job</Button>}
    </div>
    <Dialog open={dialog !== null} title={dialog === "cancel" ? "Cancel this job?" : "Edit job"} role={dialog === "cancel" ? "alertdialog" : "dialog"} onClose={close} dismissible={!saving}
      footer={<><Button variant="secondary" disabled={saving} onClick={close}>{dialog === "cancel" ? "Keep job" : "Not now"}</Button><Button variant={dialog === "cancel" ? "destructive" : "primary"} type={dialog === "edit" ? "submit" : "button"} form={dialog === "edit" ? formId : undefined} loading={saving} disabled={!online || changed} onClick={dialog === "cancel" ? () => void run("cancel") : undefined}>{dialog === "cancel" ? "Cancel job" : "Save changes"}</Button></>}>
      <div className={styles.editBody}>
        {!online && <Banner tone="alert" title="You’re offline." live className={styles.notice} />}
        {failed && <WaitingIssueNotice kind={dialog === "cancel" ? "cancel" : "edit"} />}
        {changed && <WaitingIssueNotice kind="changed" />}
        {dialog === "cancel" ? <p>It hasn’t been paid for yet, so cancelling is free.</p> : <form id={formId} ref={form} onSubmit={submit} noValidate data-offline-queue="off" className={styles.editForm}>
          <TextField label="Job title" name="title" value={draft.title} maxLength={200} required disabled={saving || changed} error={fields.title} onChange={event => setDraft({ ...draft, title: event.target.value })} />
          <TextAreaField label="Describe the job" name="description" value={draft.description} maxLength={1000} required disabled={saving || changed} error={fields.description} onChange={event => setDraft({ ...draft, description: event.target.value })} />
          <TextAreaField label="Anything else? (optional)" name="accessNotes" value={draft.accessNotes} maxLength={1000} disabled={saving || changed} error={fields.accessNotes} onChange={event => setDraft({ ...draft, accessNotes: event.target.value })} />
        </form>}
      </div>
    </Dialog>
  </div>;
}
