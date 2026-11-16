"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { TextLink } from "@/components/TextLink";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { OfflineBanner, useOnlineStatus } from "@/components/feedback";
import { TextField, TextAreaField } from "@/components/forms";
import { Banner } from "@/components/overlays/Banner";
import { modeForRole, type Role } from "@/lib/mode";
import type { MessageResult } from "@/lib/problem-threads";
import type { AuthFailure } from "@/lib/auth/results";
import { SUPPORT_ERRORS, supportRequestSchema, type SupportRequestInput } from "@/lib/support";
import { supportReturn, supportThreadHref } from "@/lib/support-return";
import { openSupportThreadAction } from "@/server/messages/support-actions";
import styles from "./support-start.module.css";
export type SupportOpenAction = (input: SupportRequestInput) => Promise<MessageResult | AuthFailure>;
type Props = { role: Role; returnTo?: string; preview?: string; action?: SupportOpenAction; onStarted?: (id: string) => void; initial?: { subject: string; text: string }; requestKey?: string };
export function SupportStart({ role, returnTo = "/help", preview, action = openSupportThreadAction, onStarted, initial, requestKey: initialKey }: Props) {
  const router = useRouter(), session = useOptionalSessionExpired(), online = useOnlineStatus(), pending = useRef(false), form = useRef<HTMLFormElement>(null);
  const [requestKey, setRequestKey] = useState(initialKey ?? ""), [subject, setSubject] = useState(initial?.subject ?? ""), [text, setText] = useState(initial?.text ?? "");
  const [busy, setBusy] = useState(false), [attempted, setAttempted] = useState(["error", "try-later"].includes(preview ?? "")), [fieldErrors, setFieldErrors] = useState(preview === "field-errors");
  const [error, setError] = useState(preview === "try-later" ? SUPPORT_ERRORS["try-later"] : preview === "error" ? "Couldn’t send. Try again." : "");
  useEffect(() => { let active = true; if (!initialKey) queueMicrotask(() => { if (active) setRequestKey(crypto.randomUUID()); }); return () => { active = false; }; }, [initialKey]);
  const connected = online && preview !== "offline", saving = busy || preview === "sending";
  const valid = supportRequestSchema.safeParse({ subject, text, requestKey }).success;
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending.current || saving || !connected) return;
    if (!valid) { setFieldErrors(true); return; }
    pending.current = true; setBusy(true); setAttempted(true); setError("");
    try {
      const result = await action({ subject, text, requestKey });
      if (session?.check(result, { resend: () => form.current?.requestSubmit() })) return;
      if (result.ok) { if (onStarted) onStarted(result.threadId); else router.push(supportThreadHref(result.threadId, returnTo)); }
      else setError(result.error === "try-later" ? SUPPORT_ERRORS["try-later"] : "Couldn’t send. Try again.");
    } catch { setError("Couldn’t send. Try again."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className={styles.page} data-mode={modeForRole(role)}>
    <div className={styles.backRow}><TextLink href={supportReturn(returnTo)}>Back</TextLink><TextLink href="/support">Your messages</TextLink></div>
    <header className={styles.header}><h1>Message us</h1><p>We reply within one working day.</p></header>
    <OfflineBanner online={connected} sticky={false} />
    <form ref={form} className={styles.card} onSubmit={submit} noValidate data-offline-queue="off">
      <TextField label="Subject" name="subject" required maxLength={160} value={subject} disabled={saving} readOnly={attempted} onChange={event => setSubject(event.target.value)} error={fieldErrors && !subject.trim() ? "Write a subject." : undefined} />
      <TextAreaField label="Message" name="message" required maxLength={4000} rows={6} value={text} disabled={saving} readOnly={attempted} onChange={event => setText(event.target.value)} error={fieldErrors && !text.trim() ? "Write a message." : undefined} />
      {error && <Banner tone="alert" title={error} live action={<Button variant="tertiary" disabled={saving || !connected} onClick={() => form.current?.requestSubmit()}>Try again</Button>} />}
      <div><Button type="submit" width="auto" loading={saving} disabled={!connected ? "You’re offline" : !valid || saving}>Send</Button></div>
    </form>
  </section>;
}
