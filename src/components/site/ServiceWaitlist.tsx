"use client";

import { useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/Button";
import { useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { TextField } from "@/components/forms/TextFields";
import { Banner } from "@/components/overlays/Banner";
import { CATEGORY_INFO, type Category } from "@/lib/cards";
import { LANDING_LOCATION_MAX } from "@/lib/landing";
import { serviceWaitlistInput } from "@/lib/services";
import type { WaitlistResult, WaitlistState } from "@/lib/waitlist";

import styles from "./service.module.css";

export function ServiceWaitlist({ category, location, submit, initialState = "empty" }: {
  category: Category; location: string; submit: (form: FormData) => Promise<WaitlistResult>; initialState?: WaitlistState;
}) {
  const [state, setState] = useState(initialState);
  const [email, setEmail] = useState("");
  const [suburb, setSuburb] = useState(location);
  const [field, setField] = useState<"email" | "suburb">();
  const emailRef = useRef<HTMLInputElement>(null);
  const suburbRef = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const online = useOnlineStatus();
  const offline = !online || initialState === "offline";
  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (offline || pending.current || state === "loading") return;
    const parsed = serviceWaitlistInput.safeParse({ email, suburb, trade: category });
    if (!parsed.success) {
      const next = parsed.error.issues[0]?.path[0] === "suburb" ? "suburb" : "email";
      setField(next); setState("error"); (next === "email" ? emailRef : suburbRef).current?.focus(); return;
    }
    pending.current = true; setField(undefined); setState("loading");
    const form = new FormData();
    for (const [key, value] of Object.entries(parsed.data)) form.set(key, value);
    try { const result = await submit(form); setState(result.status); if (result.status === "error") setField(result.field); }
    catch { setState("error"); }
    finally { pending.current = false; }
  }
  function edit() { setState("empty"); setField(undefined); }
  return <div className={styles.waitlist}>
    <p>Pop your email in and we’ll tell you when {CATEGORY_INFO[category].name.toLowerCase()} jobs are available.</p>
    <form aria-label={`${CATEGORY_INFO[category].name} waitlist`} method="post" onSubmit={join} noValidate>
      <TextField ref={suburbRef} label="Suburb" name="suburb" autoComplete="address-level2" required maxLength={LANDING_LOCATION_MAX} value={suburb} readOnly={state === "loading"} error={field === "suburb" ? "Enter your suburb." : undefined} onChange={(e) => { setSuburb(e.target.value); edit(); }} />
      <div className={styles.waitlistRow}>
        <TextField ref={emailRef} label="Email" name="email" type="email" autoComplete="email" placeholder="you@email.co.nz" required maxLength={254} value={email} readOnly={state === "loading"} error={field === "email" ? "Enter your email." : undefined} onChange={(e) => { setEmail(e.target.value); edit(); }} />
        <Button type="submit" loading={state === "loading"} disabled={offline}>Tell me</Button>
      </div>
    </form>
    {offline && <Banner tone="alert" title="You’re offline. Your details are still here." live />}
    {state === "error" && !field && !offline && <Banner tone="alert" title="Couldn’t join the list. Try again." live />}
    {(state === "joined" || state === "already-on-list") && <Banner tone="good" title={state === "joined" ? "You’re on the list." : "You’re already on the list."} live />}
  </div>;
}
