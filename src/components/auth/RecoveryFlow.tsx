"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { TextLink } from "@/components/TextLink";
import { OfflineBanner, useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { PasswordField, TextField } from "@/components/forms/TextFields";
import { Banner } from "@/components/overlays/Banner";
import { recoveryLoginPath, recoveryPasswordErrors, recoverySeconds, type RecoverySaveResult, type RecoverySendResult, type RecoveryState } from "@/lib/auth/recovery";
import { requestRecoveryAction, saveRecoveryAction } from "@/server/auth/recovery-actions";

import styles from "./recovery.module.css";

export type RecoveryFlowProps = {
  initialState?: RecoveryState;
  initialEmail?: string;
  initialRetryAt?: number;
  initialSeconds?: number;
  initialError?: string;
  next?: string;
  send?: (email: string, next?: string) => Promise<RecoverySendResult>;
  save?: (password: string, confirmation: string) => Promise<RecoverySaveResult>;
  previewPending?: boolean;
  previewOffline?: boolean;
  previewMismatch?: boolean;
  previewName?: string;
};

const titles: Record<RecoveryState, string> = {
  request: "Forgot your password?",
  sent: "Check your inbox",
  reset: "Choose a new password",
  complete: "Password changed",
  expired: "Reset your password",
  invalid: "Reset your password",
  unavailable: "Reset your password",
  finish: "Password saved",
};

export function RecoveryFlow({ initialState = "request", initialEmail = "", initialRetryAt = 0, initialSeconds = 0, initialError, next,
  send = requestRecoveryAction, save = saveRecoveryAction, previewPending = false, previewOffline = false, previewMismatch = false, previewName }: RecoveryFlowProps) {
  const headingId = useId();
  const Container = previewName ? "section" : "main";
  const Heading = previewName ? "h3" : "h1";
  const connected = useOnlineStatus();
  const online = connected && !previewOffline;
  const [state, setState] = useState(initialState);
  const [email, setEmail] = useState(initialEmail);
  const [editing, setEditing] = useState(!initialEmail || initialState === "request");
  const [password, setPassword] = useState(previewMismatch ? "korimako-gumboot-41" : "");
  const [confirmation, setConfirmation] = useState(previewMismatch ? "korimako-gumboot-42" : "");
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [confirmationError, setConfirmationError] = useState<string | undefined>(previewMismatch ? "These don’t match." : undefined);
  const [confirmationChecked, setConfirmationChecked] = useState(previewMismatch);
  const [emailError, setEmailError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [retryAt, setRetryAt] = useState(initialRetryAt);
  const [seconds, setSeconds] = useState(initialSeconds);
  const [working, setWorking] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const busy = useRef(false);
  const mounted = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const emailField = useRef<HTMLInputElement>(null);
  const passwordField = useRef<HTMLInputElement>(null);
  const confirmationField = useRef<HTMLInputElement>(null);
  const pending = working || previewPending;
  const resetting = state === "reset";
  const finish = state === "finish";
  const complete = state === "complete";

  useEffect(() => {
    if (mounted.current) heading.current?.focus();
    mounted.current = true;
  }, [state]);

  useEffect(() => {
    if (!retryAt) return;
    const timer = setInterval(() => setSeconds(recoverySeconds(retryAt)), 1_000);
    return () => clearInterval(timer);
  }, [retryAt]);

  async function requestLink() {
    if (busy.current || pending || !online || seconds > 0) return;
    busy.current = true;
    setWorking(true);
    setError(null);
    setEmailError(undefined);
    try {
      const result = await send(email, next);
      if (result.ok) {
        setEmail(result.email);
        setEditing(false);
        setRetryAt(result.retryAt);
        setSeconds(recoverySeconds(result.retryAt));
        setState("sent");
        setAnnouncement("Check your email for a reset link.");
      } else if (result.error === "invalid-email") {
        setEmailError("Enter a valid email.");
        emailField.current?.focus();
      } else {
        setError(result.error === "try-later" ? "Too many tries. Wait a minute, then resend." : "Couldn’t send the link. Try again.");
        if (result.retryAt) {
          setRetryAt(result.retryAt);
          setSeconds(recoverySeconds(result.retryAt));
        }
      }
    } catch {
      setError("Couldn’t send the link. Try again.");
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  async function resetPassword() {
    if (busy.current || pending || !online) return;
    setError(null);
    if (!finish) {
      const problems = recoveryPasswordErrors(password, confirmation, email);
      setPasswordError(problems.password);
      setConfirmationError(problems.confirmation);
      setConfirmationChecked(true);
      if (problems.password || problems.confirmation) {
        (problems.password ? passwordField : confirmationField).current?.focus();
        return;
      }
    }
    busy.current = true;
    setWorking(true);
    try {
      const result = await save(password, confirmation);
      if (result.ok || result.error === "invalid" || result.error === "sign-out") {
        setPassword("");
        setConfirmation("");
        setState(result.ok ? "complete" : result.error === "invalid" ? "expired" : "finish");
        if (!result.ok && result.error === "sign-out") setError("Couldn’t finish signing out. Try again.");
        if (!result.ok && result.error === "invalid" && result.message) setError(result.message);
        setAnnouncement(result.ok ? "Password changed. Log in with your new password." : result.error === "sign-out" ? "Password saved. Finish signing out other devices." : "That link has expired or was already used.");
      } else if (result.error === "password" || result.error === "confirmation") {
        if (result.error === "password") setPasswordError(result.message ?? "Choose a stronger password.");
        else setConfirmationError(result.message ?? "These don’t match.");
        (result.error === "password" ? passwordField : confirmationField).current?.focus();
      } else {
        setError(result.error === "try-later" ? "Too many tries. Wait a minute, then try again." : finish ? "Couldn’t finish signing out. Try again." : "Couldn’t save your password. Try again.");
      }
    } catch {
      setError(finish ? "Couldn’t finish signing out. Try again." : "Couldn’t save your password. Try again.");
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  return <Container id={previewName ? undefined : "main"} aria-label={previewName} aria-labelledby={previewName ? undefined : headingId} className={styles.page} data-mode="customer">
    <div className={`${styles.card} tm-anim-rise`}>
      <Heading id={headingId} className={styles.title} ref={heading} tabIndex={-1}>{titles[state]}</Heading>
      {state === "request" && <p className={styles.lede}>Enter your account email. We’ll send a reset link.</p>}
      {state === "sent" && <p className={styles.lede}>If an account uses <strong>{email}</strong>, you’ll get a reset link. Check your spam folder too.</p>}
      {resetting && <p className={styles.lede}>For <strong>{email}</strong>. Use 10+ characters.</p>}
      {finish && <p className={styles.lede}>Finish signing out other devices, then log in again.</p>}
      {complete && <p className={styles.lede}>Log in with your new password. Other devices will need to log in again.</p>}
      <div className={styles.feedback}>
        {previewOffline ? <Banner tone="alert" title="Offline.">Reconnect to continue.</Banner> : <OfflineBanner sticky={false} />}
        {state === "expired" && <Banner tone="alert" icon="link_off" title="That link has expired or was already used.">Send a new one below.</Banner>}
        {state === "invalid" && <Banner tone="alert" icon="link_off" title="That link isn’t valid.">Send a new one below.</Banner>}
        {state === "unavailable" && <Banner tone="alert" title="Can’t open this link yet.">Open the link in your email again, or request a new one below.</Banner>}
        {error && <Banner tone="alert" live>{error}</Banner>}
      </div>
      {complete ? <Button href={recoveryLoginPath(next)} width="full">Log in</Button> : resetting || finish ? (
        <form className={styles.form} noValidate aria-busy={pending} onSubmit={(event) => { event.preventDefault(); void resetPassword(); }}>
          {!finish && <>
            <PasswordField ref={passwordField} label="New password" name="password" autoComplete="new-password" variant="box" required value={password} error={passwordError}
              onChange={(event) => { setPassword(event.target.value); setPasswordError(undefined); setConfirmationChecked(false); setConfirmationError(undefined); }}
              onBlur={() => setPasswordError(recoveryPasswordErrors(password, confirmation, email).password)} />
            <PasswordField ref={confirmationField} label="Type it again" name="confirmation" autoComplete="new-password" variant="box" required value={confirmation} error={confirmationError}
              success={confirmationChecked && Boolean(confirmation) && password === confirmation ? "Passwords match." : undefined}
              onChange={(event) => { setConfirmation(event.target.value); setConfirmationChecked(false); setConfirmationError(undefined); }}
              onBlur={() => { setConfirmationChecked(true); setConfirmationError(recoveryPasswordErrors(password, confirmation, email).confirmation); }} />
          </>}
          <Button type="submit" width="full" loading={pending} disabled={!online ? "You’re offline. Reconnect to continue." : false}>{finish ? "Finish reset" : "Save new password"}</Button>
        </form>
      ) : <>
        <form className={styles.form} noValidate aria-busy={pending} onSubmit={(event) => { event.preventDefault(); void requestLink(); }}>
          {editing && <TextField ref={emailField} label="Email" type="email" autoComplete="email" name="email" inputMode="email" maxLength={254} required value={email} error={emailError}
            onChange={(event) => { setEmail(event.target.value); setEmailError(undefined); }} />}
          <Button type="submit" width="full" loading={pending} disabled={!online ? "You’re offline. Reconnect to continue." : seconds > 0}
            aria-label={seconds > 0 ? `Resend in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : undefined}>
            {seconds > 0 ? <span role="timer" aria-live="off">Resend in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span> : state === "sent" ? "Resend link" : state === "request" ? "Send reset link" : "Send a new link"}
          </Button>
        </form>
        {!editing && <p className={styles.caption}>Wrong email? <Button variant="tertiary" onClick={() => { setEditing(true); setState("request"); setRetryAt(0); setSeconds(0); setError(null); }}>Change it</Button></p>}
      </>}
      {!complete && <p className={styles.caption}><TextLink href={recoveryLoginPath(next)}>Back to log in</TextLink></p>}
      <p role="status" aria-live="polite" className={styles.srOnly}>{announcement}</p>
    </div>
  </Container>;
}
