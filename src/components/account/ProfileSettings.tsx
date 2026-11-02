"use client";
// Account > Profile (#112, E04): mockup w-account for the layout, sh-profile-edit for the fields. Text-heavy forms use
// an explicit Save button (WEBAPP_SPEC E04 note 3): it stays off until something changes, shows "Saving" while it
// works, then a "Saved." toast (M14). The email is shown but changed in Security, where the new address is confirmed
// before it replaces the old one.

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { TextLink } from "@/components/TextLink";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { InlineError, LiveMessage, LoadingRegion, OfflineBanner, Skeleton, useOnlineStatus } from "@/components/feedback";
import { TextField } from "@/components/forms/TextFields";
import { Avatar } from "@/components/media/Avatar";
import { Banner } from "@/components/overlays/Banner";
import { ToastProvider, useToast } from "@/components/overlays/Toast";
import { uploadAvatar as liveUpload, type AvatarUpload } from "@/lib/account/avatar-upload";
import { type ProfileFieldErrors, type ProfileInput, type ProfileResult, parseProfile, profileChanged } from "@/lib/account/profile";
import type { AuthFailure } from "@/lib/auth/results";
import { PHOTO_ACCEPT } from "@/lib/media";
import { saveProfileAction } from "@/server/account/profile-actions";

import account from "./account.module.css";
import styles from "./profile.module.css";

export type ProfileAction = (previous: ProfileResult | null, form: FormData) => Promise<ProfileResult | AuthFailure>;
export type ProfilePreview = "offline";

type Attempt = { result: ProfileResult | AuthFailure | null; count: number };

export function ProfileLoading() {
  return <LoadingRegion loading label="Loading your profile" skeleton={<div className={account.sections}>
    <h1 className={account.title}>Profile</h1>
    <div className={account.card}>
      <div className={styles.photoRow}><Skeleton shape="circle" width={72} height={72} /><Skeleton width={120} height={20} /></div>
      {[0, 1, 2].map(item => <div key={item} className={styles.skeletonField}><Skeleton width={90} height={14} /><Skeleton height={48} /></div>)}
    </div>
  </div>} />;
}

export function ProfileSettings(props: ProfileSettingsProps) {
  return <ToastProvider><ProfileForm {...props} /></ToastProvider>;
}

export type ProfileSettingsProps = {
  /** What is saved now, as form text. */
  initial: ProfileInput;
  /** Shown, not editable here: Security changes it. */
  email: string;
  /** An address waiting to be confirmed. The email above stays until the link in the new inbox is followed. */
  pendingEmail?: string;
  /** A link to the photo that expires soon; without one, the initials show. */
  avatarUrl?: string | null;
  action?: ProfileAction;
  upload?: AvatarUpload;
  /** Visual states for the guarded component catalogue only; never affects authorization or what is saved. */
  preview?: ProfilePreview;
};

function ProfileForm({ initial, email, pendingEmail, avatarUrl = null, action = saveProfileAction, upload = liveUpload, preview }: ProfileSettingsProps) {
  const toast = useToast();
  const router = useRouter();
  const sessionExpired = useOptionalSessionExpired();
  const formRef = useRef<HTMLFormElement>(null);
  const emailHint = useId();
  const [saved, setSaved] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone);
  const [errors, setErrors] = useState<ProfileFieldErrors>({});
  const online = useOnlineStatus() && preview !== "offline";

  const [attempt, submit, submitting] = useActionState(async (previous: Attempt, form: FormData): Promise<Attempt> => {
    let result: ProfileResult | AuthFailure;
    try { result = await action(null, form); }
    catch { result = { ok: false, error: "unavailable" }; }
    if (result.ok) {
      setSaved({ name: result.name, phone: result.phone });
      // Show the tidied values, unless they kept typing while this saved: newer edits stay, and Save stays on for them.
      const sentName = form.get("name"), sentPhone = form.get("phone");
      setName(current => (current === sentName ? result.name : current));
      setPhone(current => (current === sentPhone ? result.phone : current));
      setErrors({});
      toast.show({ message: "Saved." });
    } else if (result.error === "invalid") setErrors(result.fields);
    else if (result.error === "session-expired") sessionExpired?.check(result, { resend: () => formRef.current?.requestSubmit() });
    return { result, count: previous.count + 1 };
  }, { result: null, count: 0 });
  const pending = submitting;
  const result = attempt.result;
  const failure = result && !result.ok && result.error !== "invalid" ? result.error : null;

  useEffect(() => {
    if (attempt.count === 0) return;
    formRef.current?.querySelector<HTMLInputElement>("input[aria-invalid=true]")?.focus();
  }, [attempt.count]);

  const changed = profileChanged(saved, { name, phone });

  return <>
    <h1 className={account.title}>Profile</h1>
    <OfflineBanner online={online} sticky={false} />
    {pendingEmail && <Banner tone="info">Check {pendingEmail} and your current inbox to confirm your new email.</Banner>}
    <section className={account.card} aria-label="Profile details">
      <PhotoRow name={name || saved.name} initialUrl={avatarUrl} upload={upload} online={online} />
      <form ref={formRef} action={submit} className={account.form} noValidate aria-label="Profile" aria-busy={pending}
        onSubmit={event => {
          const invalid = parseProfile({ name, phone });
          if (!changed || pending) event.preventDefault();
          else if (!invalid.ok) {
            // Say what is wrong straight away; the server checks the same rules again.
            event.preventDefault();
            setErrors(invalid.fields);
            formRef.current?.querySelector<HTMLInputElement>(invalid.fields.name ? "input[name=name]" : "input[name=phone]")?.focus();
          }
        }}>
        {failure && (failure === "session-expired" || failure === "forbidden"
          ? <InlineError message="Log in to save." retryLabel="Log in" onRetry={() => router.push("/login?next=%2Fprofile")} />
          : <InlineError message="Couldn’t save." onRetry={online ? () => formRef.current?.requestSubmit() : undefined} />)}
        <div className={account.fields}>
          <TextField name="name" label="Full name" autoComplete="name" required maxLength={161} value={name}
            onChange={event => { setName(event.target.value); setErrors(current => ({ ...current, name: undefined })); }} error={errors.name} />
          <div className={styles.emailRow}>
            <TextField label="Email" type="email" readOnly value={email} autoComplete="email" aria-describedby={emailHint} />
            <p id={emailHint} className={account.hint}>We send receipts and updates here. <TextLink href="/profile/security" inline>Change email</TextLink></p>
          </div>
          <TextField name="phone" label="Mobile" type="tel" autoComplete="tel" inputMode="tel" required maxLength={24} value={phone}
            onChange={event => { setPhone(event.target.value); setErrors(current => ({ ...current, phone: undefined })); }} error={errors.phone} />
        </div>
        <div className={styles.actions}>
          <Button type="submit" loading={pending} disabled={!changed ? true : !online ? "Reconnect before saving." : undefined}>Save changes</Button>
        </div>
        <LiveMessage message={pending ? "Saving…" : null} />
      </form>
    </section>
  </>;
}

function PhotoRow({ name, initialUrl, upload, online }: { name: string; initialUrl: string | null; upload: AvatarUpload; online: boolean }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inputId = useId();
  return <div className={styles.photo}>
    <div className={styles.photoRow}>
      <Avatar name={name || "?"} src={url} size="lg" decorative />
      <Button variant="tertiary" loading={busy} disabled={online ? undefined : "Reconnect before saving."} onClick={() => input.current?.click()} aria-describedby={problem ? `${inputId}-problem` : undefined}>Change photo</Button>
      <input ref={input} type="file" accept={PHOTO_ACCEPT} hidden tabIndex={-1} onChange={async event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (!file) return;
        setBusy(true);
        setProblem(null);
        const answer = await upload(file);
        setBusy(false);
        if (answer.ok) { setUrl(answer.url); toast.show({ message: "Saved." }); }
        else setProblem(answer.message);
      }} />
    </div>
    {problem && <div id={`${inputId}-problem`}><InlineError message={problem} /></div>}
    <LiveMessage message={busy ? "Saving…" : null} />
  </div>;
}
