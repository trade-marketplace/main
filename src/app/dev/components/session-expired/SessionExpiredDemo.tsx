"use client";
// The preview around the session-expired dialog (#108): a pretend customer page with a draft and a pretend server
// that has lost the session. Dev only (see page.tsx). Nothing here talks to Supabase.
import Link from "next/link";
import { type FormEvent, useState } from "react";

import { AppShellView, type ShellViewer } from "@/components/app/AppShellView";
import {
  type LogInAgain,
  SessionExpiredDialog,
  SessionExpiredProvider,
  useSessionExpired,
} from "@/components/auth/SessionExpired";
import { Button } from "@/components/Button";
import { TextAreaField } from "@/components/forms";
import { keptFormValues, type SessionExpired } from "@/lib/auth/results";

import { DEMO_DRAFT, DEMO_EMAIL, PREVIEW_STATES, type PreviewOpen, type PreviewState } from "./demo-data";
import styles from "./session-expired.module.css";

const BASE = "/dev/components/session-expired";

const VIEWER: ShellViewer = {
  role: "CUSTOMER",
  firstName: "Sarah",
  lastName: "Thompson",
  email: DEMO_EMAIL,
  counts: { messages: 1, notifications: 2 },
};

/** The pretend log-in: a password named after a state gives that answer ("wrong", "locked"…); any other works. */
function pretendLogIn(onSuccess: () => void): LogInAgain {
  return async (_previous, formData) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    if (!password) return { ...PREVIEW_STATES.invalid, values: { email } };
    if (Object.hasOwn(PREVIEW_STATES, password)) return { ...PREVIEW_STATES[password as PreviewState], values: { email } };
    onSuccess();
    return { ok: true, role: "CUSTOMER", redirectTo: "/" };
  };
}

type Props = { open?: PreviewOpen; state?: PreviewState; knownEmail: boolean };

export function SessionExpiredDemo({ open, state, knownEmail }: Props) {
  // The pretend server: the session is gone until the dialog logs in again.
  const [server] = useState(() => ({ signedIn: false }));
  const [logIn] = useState(() => pretendLogIn(() => (server.signedIn = true)));
  const [previewOpen, setPreviewOpen] = useState(Boolean(open));
  const email = knownEmail ? DEMO_EMAIL : undefined;

  return (
    <AppShellView viewer={VIEWER} testMode>
      <SessionExpiredProvider logIn={logIn} email={email} role="CUSTOMER">
        <div className={styles.wrap}>
          <p className={styles.eyebrow}>Dev only · not in production builds</p>
          <h1 className={styles.title}>Session expired</h1>
          <p className={styles.lede}>
            When a page sends a form and the server says the session has gone, “You’ve been logged out” shows over the
            page (B07). Logging in again keeps the page and the draft, then sends it. Here the pretend server has
            already lost the session: press “Save draft”.
          </p>
          <nav aria-label="Previews" className={styles.links}>
            <Link href={`${BASE}?open=notice`}>Open on load</Link>
            <Link href={`${BASE}?open=form`}>The log-in step</Link>
            <Link href={`${BASE}?state=wrong`}>Wrong password</Link>
            <Link href={`${BASE}?state=locked`}>Too many tries</Link>
            <Link href={`${BASE}?state=unverified`}>Email not confirmed</Link>
            <Link href={`${BASE}?state=unavailable`}>Can’t log in now</Link>
            <Link href={`${BASE}?email=off&open=form`}>Email not known</Link>
          </nav>
          <p className={styles.hint}>
            In the pretend log-in, any password works except <code>wrong</code>, <code>locked</code>,{" "}
            <code>unverified</code> and <code>unavailable</code>, which give those answers.
          </p>
          <DraftForm server={server} />
        </div>
        {open && (
          <SessionExpiredDialog
            open={previewOpen}
            logIn={logIn}
            onLoggedIn={() => setPreviewOpen(false)}
            email={email}
            initialStep={open}
            initialState={state ? PREVIEW_STATES[state] : null}
          />
        )}
      </SessionExpiredProvider>
    </AppShellView>
  );
}

/** A pretend “Describe the job” step. Saving answers session-expired until the dialog has logged in again. */
function DraftForm({ server }: { server: { signedIn: boolean } }) {
  const sessionExpired = useSessionExpired();
  const [saved, setSaved] = useState("");

  const save = (formData: FormData) => {
    const result: SessionExpired | { ok: true } = server.signedIn
      ? { ok: true }
      : { ok: false, error: "session-expired", values: keptFormValues(formData) };
    if (sessionExpired.check(result, { resend: () => save(formData) })) return;
    setSaved(String(formData.get("description") ?? ""));
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    save(new FormData(event.currentTarget));
  };

  return (
    <form onSubmit={submit} className={styles.card} aria-labelledby="draft-title">
      <h2 id="draft-title" className={styles.cardTitle}>
        What needs doing?
      </h2>
      <TextAreaField label="Describe the job" name="description" defaultValue={DEMO_DRAFT} rows={4} />
      <div className={styles.actions}>
        <Button type="submit" width="auto">
          Save draft
        </Button>
      </div>
      <p role="status" className={styles.status}>
        {saved && <>Saved: “{saved}”</>}
      </p>
    </form>
  );
}
