"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { TextLink } from "@/components/TextLink";
import { OfflineBanner, useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { TextField } from "@/components/forms/TextFields";
import { Banner } from "@/components/overlays/Banner";
import { VERIFICATION_POLL_MS, verificationSeconds, type VerificationSendResult, type VerificationState, type VerificationStatus } from "@/lib/auth/verification";
import { changeVerificationAccountAction, resendVerificationAction, verificationStatusAction } from "@/server/auth/verification-actions";

import styles from "./verify-email.module.css";

export type VerifyEmailProps = {
  initialState?: VerificationState;
  initialEmail?: string;
  initialRetryAt?: number;
  initialSeconds?: number;
  initialError?: string;
  next?: string;
  signedIn?: boolean;
  continueTo: string;
  send?: (email: string, next?: string) => Promise<VerificationSendResult>;
  check?: (next?: string) => Promise<VerificationStatus>;
  previewPending?: boolean;
  previewOffline?: boolean;
};

export function VerifyEmail({ initialState = "ready", initialEmail = "", initialRetryAt = 0, initialSeconds = 0, initialError,
  next, signedIn = false, continueTo, send = resendVerificationAction, check = verificationStatusAction, previewPending = false, previewOffline = false }: VerifyEmailProps) {
  const router = useRouter();
  const connected = useOnlineStatus();
  const online = connected && !previewOffline;
  const [state, setState] = useState(initialState);
  const [email, setEmail] = useState(initialEmail);
  const [editing, setEditing] = useState(!initialEmail);
  const [retryAt, setRetryAt] = useState(initialRetryAt);
  const [seconds, setSeconds] = useState(initialSeconds);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [emailError, setEmailError] = useState<string | undefined>();
  const [announcement, setAnnouncement] = useState("");
  const sending = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  const pending = submitting || previewPending;
  const verified = state === "verified";

  useEffect(() => {
    if (!retryAt) return;
    const timer = setInterval(() => setSeconds(verificationSeconds(retryAt, Date.now())), 1_000);
    return () => clearInterval(timer);
  }, [retryAt]);

  useEffect(() => {
    if (!online || verified || state === "ready" || editing) return;
    let disposed = false;
    let checking = false;
    const poll = async () => {
      if (checking || document.hidden) return;
      checking = true;
      try {
        const result = await check(next);
        if (!disposed && result.verified) router.replace(result.redirectTo);
        else if (!disposed) setError((current) => current === "Can’t check your email yet. We’ll try again." ? null : current);
      } catch {
        if (!disposed) setError("Can’t check your email yet. We’ll try again.");
      } finally {
        checking = false;
      }
    };
    const timer = setInterval(poll, VERIFICATION_POLL_MS);
    window.addEventListener("focus", poll);
    document.addEventListener("visibilitychange", poll);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener("focus", poll);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [check, next, router, online, verified, state, editing]);

  async function resend() {
    if (sending.current || pending || !online || seconds > 0) return;
    sending.current = true;
    setSubmitting(true);
    setError(null);
    setEmailError(undefined);
    try {
      const result = await send(email, next);
      if (result.ok) {
        setEmail(result.email);
        setEditing(false);
        setState("waiting");
        setRetryAt(result.retryAt);
        setSeconds(verificationSeconds(result.retryAt, Date.now()));
        setAnnouncement("Check your email for a link.");
      } else if (result.error === "invalid-email") {
        setEmailError("Enter a valid email.");
        field.current?.focus();
      } else {
        setError(result.error === "try-later" ? "Too many tries. Wait a minute, then resend." : "Couldn’t send the link. Try again.");
        if (result.retryAt) {
          setRetryAt(result.retryAt);
          setSeconds(verificationSeconds(result.retryAt, Date.now()));
        }
      }
    } catch {
      setError("Couldn’t send the link. Try again.");
    } finally {
      sending.current = false;
      setSubmitting(false);
    }
  }

  return (
    <main id="main" className={styles.page} data-mode="customer">
      <section className={`${styles.card} tm-anim-rise`} aria-labelledby="verify-title">
        <div className={styles.icon}><Icon name={verified ? "mark_email_read" : "mark_email_unread"} decorative /></div>
        <h1 id="verify-title" className={styles.title}>{verified ? "You’re all set" : editing || state === "ready" ? "Verify your email" : "Check your inbox"}</h1>
        <p className={styles.lede}>{verified ? "Your email is confirmed." : editing ? "Enter your account email. We’ll send a link to confirm it." : state === "ready" ? <>Send a link to <strong>{email}</strong> to confirm your email.</> : <>We sent a link to <strong>{email}</strong>. Tap it to confirm your email.</>}</p>
        <div className={styles.feedback}>
          {previewOffline ? <Banner tone="alert" title="Offline.">Reconnect to send a link.</Banner> : <OfflineBanner />}
          {(state === "expired" || state === "invalid") && <Banner tone="alert" icon="link_off" title={state === "expired" ? "That link has expired." : "That link isn’t valid."}>Send a new one below.</Banner>}
          {state === "unavailable" && <Banner tone="alert" title="Can’t confirm your email yet.">Try the link again, or send a new one.</Banner>}
          {error && <Banner tone="alert" live>{error}</Banner>}
        </div>
        {verified ? <Button href={continueTo} width="full">Continue</Button> : (
          <form className={styles.form} noValidate aria-busy={pending} onSubmit={(event) => { event.preventDefault(); void resend(); }}>
            {editing && <TextField ref={field} label="Email" type="email" autoComplete="email" name="email" value={email} maxLength={254} required error={emailError}
              onChange={(event) => setEmail(event.target.value)} />}
            <Button type="submit" variant="secondary" width="full" loading={pending} disabled={!online ? "You’re offline. Reconnect to send a link." : seconds > 0}
              aria-label={seconds > 0 ? `Resend in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : undefined}>
              {seconds > 0 ? <span role="timer" aria-live="off">Resend in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span> : editing || state === "ready" ? "Send a link" : "Resend email"}
            </Button>
          </form>
        )}
        {!verified && !editing && !signedIn && <p className={styles.caption}>Wrong email? <Button variant="tertiary" onClick={() => { setEditing(true); setRetryAt(0); setSeconds(0); }}>Change it</Button></p>}
        {!verified && signedIn && <form action={changeVerificationAccountAction} className={styles.caption}>
          <input type="hidden" name="next" value={next ?? ""} />
          <Button type="submit" variant="tertiary">Use another account</Button>
        </form>}
        {!verified && <p className={styles.caption}><TextLink href={continueTo}>Continue {signedIn ? "without confirming" : "to log in"}</TextLink></p>}
        <p role="status" aria-live="polite" className={styles.srOnly}>{announcement}</p>
      </section>
    </main>
  );
}
