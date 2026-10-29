"use client";

import Image from "next/image";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";

import { Button } from "@/components/Button";
import { useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { TextField } from "@/components/forms/TextFields";
import { Banner } from "@/components/overlays/Banner";
import { ToastProvider, useToast } from "@/components/overlays/Toast";
import type { Coverage } from "@/lib/geo/coverage";
import { LANDING_LOCATION_MAX } from "@/lib/landing";
import { waitlistInput, waitlistSharePath, type WaitlistResult, type WaitlistState } from "@/lib/waitlist";

import styles from "./waitlist.module.css";

type Props = {
  location: string;
  coverage: Coverage;
  submit: (form: FormData) => Promise<WaitlistResult>;
  /** Guarded local preview only. Public query flags cannot invent a successful signup. */
  initialState?: WaitlistState;
  initialEmail?: string;
};

function subscribeDraft(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
function draftSnapshot() {
  try { return sessionStorage.getItem("tm-waitlist-draft"); } catch { return null; }
}
function readDraft(raw: string | null): { email?: string; suburb?: string } {
  try {
    const draft = JSON.parse(raw ?? "null");
    return {
      email: typeof draft?.email === "string" && draft.email.length <= 254 ? draft.email : undefined,
      suburb: typeof draft?.suburb === "string" && draft.suburb.length <= LANDING_LOCATION_MAX ? draft.suburb : undefined,
    };
  } catch { return {}; }
}

export function Waitlist(props: Props) {
  return <ToastProvider><WaitlistForm {...props} /></ToastProvider>;
}

function WaitlistForm({ location, coverage, submit, initialState = "empty", initialEmail = "" }: Props) {
  const [state, setState] = useState<WaitlistState>(initialState);
  const draft = readDraft(useSyncExternalStore(subscribeDraft, draftSnapshot, () => null));
  const [enteredEmail, setEmail] = useState<string>();
  const [enteredSuburb, setSuburb] = useState<string>();
  const email = enteredEmail ?? draft.email ?? initialEmail;
  const suburb = enteredSuburb ?? (location || draft.suburb || "");
  const [field, setField] = useState<"email" | "suburb">();
  const [copyError, setCopyError] = useState(false);
  const pending = useRef(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const suburbRef = useRef<HTMLInputElement>(null);
  const online = useOnlineStatus();
  const offline = !online || initialState === "offline";
  const toast = useToast();

  // The draft stays in this tab, including offline reloads, and never stores signup status.
  function keepDraft(nextEmail: string, nextSuburb: string) {
    if (state !== "loading") { setState("empty"); setField(undefined); setCopyError(false); }
    try { sessionStorage.setItem("tm-waitlist-draft", JSON.stringify({ email: nextEmail, suburb: nextSuburb })); } catch { /* optional */ }
  }

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || state === "loading" || offline) return;
    const parsed = waitlistInput.safeParse({ email, suburb });
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.path[0] === "suburb" ? "suburb" : "email";
      setField(first); setState("error");
      (first === "suburb" ? suburbRef : emailRef).current?.focus();
      return;
    }
    pending.current = true;
    setField(undefined); setState("loading");
    const form = new FormData();
    form.set("email", parsed.data.email); form.set("suburb", parsed.data.suburb);
    try {
      const result = await submit(form);
      setState(result.status);
      if (result.status === "error") setField(result.field);
    } catch { setState("error"); } finally { pending.current = false; }
  }

  async function copy() {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(new URL(waitlistSharePath(suburb), window.location.origin).href);
      toast.show({ message: "Copied.", icon: "content_copy" });
    } catch { setCopyError(true); }
  }

  const success = state === "joined" || state === "already-on-list";
  return <section className={`${styles.page} tm-anim-rise`} aria-label={`Waitlist. Live now: ${coverage.radiusKm} km around ${coverage.name}.`}>
    <div className={styles.content}>
      <Image className={styles.van} src="/images/van.png" width={300} height={300} sizes="300px" alt="" priority />
      <h1 className={styles.title}>{suburb ? `We’re not in ${suburb} yet.` : "Not in your area yet."}</h1>
      <form className={styles.form} aria-label="Waitlist" onSubmit={join} noValidate>
        <TextField className={styles.field} ref={suburbRef} label="Suburb" labelHidden name="suburb" autoComplete="address-level2" placeholder="Suburb" required maxLength={LANDING_LOCATION_MAX}
          value={suburb} readOnly={state === "loading"} error={field === "suburb" ? "Enter your suburb." : undefined}
          onChange={(event) => { setSuburb(event.target.value); keepDraft(email, event.target.value); }} />
        <div className={styles.emailRow}>
          <TextField className={styles.field} ref={emailRef} label="Email" labelHidden name="email" type="email" autoComplete="email" placeholder="you@email.co.nz" required maxLength={254}
            value={email} readOnly={state === "loading"} error={field === "email" ? "Enter your email." : undefined}
            onChange={(event) => { setEmail(event.target.value); keepDraft(event.target.value, suburb); }} />
          <Button type="submit" loading={state === "loading"} disabled={offline} width="auto">Tell me</Button>
        </div>
      </form>
      {offline && <Banner className={styles.message} tone="alert" title="You’re offline." live />}
      {state === "error" && !field && !offline && <Banner className={styles.message} tone="alert" title="Try again." live />}
      {success && <Banner className={`${styles.message} tm-anim-rise`} tone="good" title={state === "joined" ? "You’re on the list." : "You’re on it."} live
        action={<Button className={styles.copy} variant="tertiary" onClick={copy}>copy link</Button>} />}
      {copyError && <Banner className={styles.message} tone="alert" title="Try again." live />}
    </div>
  </section>;
}
