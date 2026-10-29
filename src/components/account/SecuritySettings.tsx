"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/Button";
import { PasswordField, TextField } from "@/components/forms/TextFields";
import { Banner } from "@/components/overlays/Banner";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { SECURITY_MESSAGES, type SecurityOperation, type SecurityResult } from "@/lib/auth/security";
import { endSecuritySessionAction, securityAction } from "@/server/auth/security-actions";

import styles from "./account.module.css";

export type SecurityAction = (operation: SecurityOperation, previous: SecurityResult | null, form: FormData) => Promise<SecurityResult>;

function resultMessage(result: SecurityResult): string {
  if (!result.ok) return result.error === "invalid" ? "Check the highlighted fields." : SECURITY_MESSAGES[result.error];
  if (result.status === "email-sent") return `Check ${result.email} and your current inbox for a link. Your email stays the same until you confirm the change.`;
  if (result.status === "email-changed") return "Email changed. Confirm your new email before posting or taking a job.";
  if (result.status === "password-changed") return "Password changed. Other devices have been logged out.";
  return "Other devices have been logged out. You’re still logged in here.";
}

const TITLES: Record<SecurityOperation, string> = { email: "Email", password: "Password", sessions: "Other devices" };
const BUTTONS: Record<SecurityOperation, string> = { email: "Change email", password: "Change password", sessions: "Log out other devices" };

function SecurityForm({ operation, email, action, initial, offline, previewPending, onEmailChanged }: {
  operation: SecurityOperation; email: string; action: SecurityAction; initial?: SecurityResult | null; offline: boolean; previewPending?: boolean; onEmailChanged: (email: string) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const sessionExpired = useOptionalSessionExpired();
  const router = useRouter();
  const [reloginPending, startRelogin] = useTransition();
  const [reloginFailed, setReloginFailed] = useState(false);
  const [attempt, submit, pending] = useActionState(async (previous: { result: SecurityResult | null; count: number; email: string }, form: FormData) => {
    let result: SecurityResult;
    try { result = await action(operation, previous.result, form); }
    catch { result = { ok: false, error: "unavailable" }; }
    return { result, count: previous.count + 1, email: String(form.get("email") ?? previous.email) };
  }, { result: initial ?? null, count: 0, email: "" });
  const result = attempt.result;
  const busy = pending || previewPending;
  const fields = result && !result.ok ? result.fields : undefined;
  const [mismatch, setMismatch] = useState(false);
  useEffect(() => {
    if (!result || attempt.count === 0) return;
    if (sessionExpired?.check(result)) return;
    if (result.ok && result.status === "email-changed" && result.email) onEmailChanged(result.email);
    const field = formRef.current?.querySelector<HTMLInputElement>("input[aria-invalid=true]");
    (field ?? messageRef.current)?.focus();
  }, [result, attempt.count, onEmailChanged, sessionExpired]);

  return <section className={styles.card} aria-labelledby={`${operation}-title`}>
    <h2 id={`${operation}-title`}>{TITLES[operation]}</h2>
    {operation === "email" && <p className={styles.hint}>Current email: <strong>{email}</strong></p>}
    {operation === "password" && <p className={styles.hint}>Use 10 or more characters. Changing your password logs out other devices.</p>}
    {operation === "sessions" && <p className={styles.hint}>Log out everywhere else. You’ll stay logged in on this device. Other devices may keep access until their current session expires.</p>}
    <form ref={formRef} action={submit} className={styles.form} noValidate aria-label={BUTTONS[operation]}>
      {result && <div ref={messageRef} tabIndex={-1} className={styles.message}>
        <Banner tone={result.ok ? "good" : "alert"} live>{resultMessage(result)}</Banner>
        {!result.ok && ["session-expired", "reauthenticate"].includes(result.error) && <Button variant="tertiary" loading={reloginPending} onClick={() => startRelogin(async () => {
          try {
            const ended = await endSecuritySessionAction();
            if (ended.ok || ended.error === "session-expired") router.push("/login?next=%2Fprofile%2Fsecurity");
            else setReloginFailed(true);
          } catch { setReloginFailed(true); }
        })}>Log in again</Button>}
        {reloginFailed && <Banner tone="alert" live>Couldn’t log out of this device. Try again.</Banner>}
        {result.ok && result.status === "email-changed" && <Link href="/verify?next=%2Fprofile%2Fsecurity">Confirm email</Link>}
      </div>}
      <fieldset disabled={busy} className={styles.fields} key={attempt.count}>
        <PasswordField variant="box" name="currentPassword" label="Current password" autoComplete="current-password" error={fields?.currentPassword} required />
        {operation === "email" && <TextField name="email" type="email" label="New email" autoComplete="email" inputMode="email" spellCheck={false} defaultValue={result?.ok ? "" : attempt.email} error={fields?.email} required />}
        {operation === "password" && <>
          <PasswordField variant="box" name="password" label="New password" autoComplete="new-password" error={fields?.password} required />
          <PasswordField variant="box" name="confirmPassword" label="Confirm new password" autoComplete="new-password" required
            error={mismatch ? "Passwords don’t match." : fields?.confirmPassword}
            onBlur={() => { const form = formRef.current; setMismatch(Boolean(form && (form.elements.namedItem("confirmPassword") as HTMLInputElement).value !== (form.elements.namedItem("password") as HTMLInputElement).value)); }}
            onChange={() => setMismatch(false)} />
        </>}
      </fieldset>
      <Button type="submit" loading={busy} variant={operation === "sessions" ? "destructive" : "primary"} disabled={offline ? "Reconnect before saving." : undefined}>{BUTTONS[operation]}</Button>
      <span className={styles.srOnly} role="status">{busy ? (operation === "sessions" ? "Logging out other devices…" : "Saving…") : ""}</span>
    </form>
  </section>;
}

export function SecuritySettings({ email: initialEmail, pendingEmail, action = securityAction, initial = null, confirmError = false, preview }: {
  email: string; pendingEmail?: string; action?: SecurityAction; initial?: Partial<Record<SecurityOperation, SecurityResult>> | null; confirmError?: boolean;
  /** Visual states for the guarded component catalogue only; never affects authorization or action results. */
  preview?: "offline" | "pending";
}) {
  const [email, setEmail] = useState(initialEmail);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  return <>
    <h1 className={styles.title}>Security</h1>
    {(offline || preview === "offline") && <Banner tone="alert" live>You’re offline. Reconnect before saving.</Banner>}
    {confirmError && <Banner tone="alert">That email link has expired or is invalid. Request a new link below.</Banner>}
    {pendingEmail && <Banner tone="info">Check {pendingEmail} and your current inbox to confirm your new email.</Banner>}
    <div className={styles.sections}>
      {(["email", "password", "sessions"] as const).map(operation => <SecurityForm key={operation} operation={operation} email={email} action={action}
        initial={initial?.[operation]} offline={offline || preview === "offline"} previewPending={operation === "password" && preview === "pending"} onEmailChanged={setEmail} />)}
    </div>
  </>;
}
