"use client";
// "Can't make it" (#147): the tradie hands a claimed job back, with a reason. DECISIONS.md "Handing a job back".
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { RadioGroup } from "@/components/forms/ChoiceFields";
import { TextAreaField } from "@/components/forms/TextFields";
import { Banner } from "@/components/overlays/Banner";
import { Dialog } from "@/components/overlays/Dialog";
import type { AuthFailure } from "@/lib/auth/results";
import { bookedSoon, RELEASE_REASONS, RELEASE_WORDS, type ReleaseReason, type ReleaseResult } from "@/lib/worker-release";
import { releaseJobAction } from "@/server/jobs/worker-release-actions";
import styles from "./release-job.module.css";

export type ReleaseAction = (jobId: string, input: { reason: ReleaseReason; note?: string }) => Promise<ReleaseResult | AuthFailure>;
/** Visual states for the guarded component catalogue only. */
export type ReleasePreview = "open" | "soon" | "saving" | "extra-work" | "error";

export function ReleaseJob({ jobId, customerFirstName, bookedDate, online, preview, action = releaseJobAction, doneHref = "/dashboard" }: {
  jobId: string; customerFirstName: string; bookedDate: string | null; online: boolean; preview?: ReleasePreview; action?: ReleaseAction; doneHref?: string;
}) {
  const router = useRouter(), session = useOptionalSessionExpired(), name = useId(), pending = useRef(false);
  const [open, setOpen] = useState(Boolean(preview)), [reason, setReason] = useState<ReleaseReason | null>(null), [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "extra-work" | "changed" | "error">(preview === "saving" || preview === "extra-work" || preview === "error" ? preview : "idle");
  const [missing, setMissing] = useState(false);
  const soon = preview === "soon" || bookedSoon(bookedDate ? new Date(`${bookedDate}T00:00:00Z`) : null, new Date());
  const saving = state === "saving";
  async function confirm() {
    if (pending.current || preview) return;
    if (!reason) { setMissing(true); return; }
    pending.current = true; setState("saving");
    try {
      const result = await action(jobId, { reason, ...(note.trim() ? { note: note.trim() } : {}) });
      if (session?.check(result)) { setState("idle"); return; }
      if ("status" in result && result.status === "released") { setOpen(false); router.push(doneHref); router.refresh(); return; }
      setState("status" in result && (result.status === "extra-work" || result.status === "changed") ? result.status : "error");
    } catch { setState("error"); }
    finally { pending.current = false; }
  }
  return <>
    <Button variant="tertiary" icon="assignment_return" disabled={!online ? "You’re offline" : undefined} onClick={() => { setState("idle"); setMissing(false); setOpen(true); }}>{RELEASE_WORDS.open}</Button>
    <Dialog open={open} title={RELEASE_WORDS.title} description={RELEASE_WORDS.body(customerFirstName)} onClose={() => { if (!saving) setOpen(false); }} dismissible={!saving} size="sm" phoneLayout="dialog"
      footer={<div className={styles.buttons}><Button variant="secondary" disabled={saving} onClick={() => setOpen(false)}>{RELEASE_WORDS.keep}</Button>
        <Button variant="destructive" loading={saving} disabled={!online ? "You’re offline" : saving} onClick={() => void confirm()}>{RELEASE_WORDS.confirm}</Button></div>}>
      <div className={styles.body}>
        {soon && <Banner tone="info">{RELEASE_WORDS.soon}</Banner>}
        <RadioGroup label={RELEASE_WORDS.reason} name={name} required options={RELEASE_REASONS.map(value => ({ value, label: value }))} value={reason ?? ""}
          onChange={value => { setReason(value as ReleaseReason); setMissing(false); }} disabled={saving} error={missing ? "Pick a reason." : undefined} />
        <TextAreaField label={RELEASE_WORDS.note} value={note} maxLength={500} onChange={event => setNote(event.target.value)} disabled={saving} />
        {state === "extra-work" && <Banner tone="alert" live>{RELEASE_WORDS.extraWork}</Banner>}
        {state === "changed" && <Banner tone="alert" live>{RELEASE_WORDS.changed}</Banner>}
        {state === "error" && <Banner tone="alert" live>{RELEASE_WORDS.error}</Banner>}
      </div>
    </Dialog>
  </>;
}
