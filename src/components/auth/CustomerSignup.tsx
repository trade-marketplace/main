"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { CheckboxField } from "@/components/forms/ChoiceFields";
import { PasswordField, TextField } from "@/components/forms/TextFields";
import { Banner } from "@/components/overlays/Banner";
import { passwordStrength, signupLink } from "@/lib/auth/signup";
import { signUpAction, type SignUpState } from "@/server/auth/actions";

import { AuthLayout } from "./AuthLayout";
import { detailsHref, SignupRoleChoices } from "./SignupChoice";
import styles from "./auth.module.css";

export type CustomerSignupProps = { next?: string; initialState?: SignUpState; previewPending?: boolean; previewOffline?: boolean };

export function CustomerSignup({ next, initialState = null, previewPending = false, previewOffline = false }: CustomerSignupProps) {
  const router = useRouter();
  const problemAtStart = initialState && !initialState.ok ? initialState : null;
  const [name, setName] = useState([problemAtStart?.values.firstName, problemAtStart?.values.lastName].filter(Boolean).join(" "));
  const [email, setEmail] = useState(problemAtStart?.values.email ?? "");
  const [phone, setPhone] = useState(problemAtStart?.values.phone ?? "");
  const [password, setPassword] = useState("");
  const [terms, setTerms] = useState(problemAtStart?.values.terms === "on");
  const [connected, setConnected] = useState(true);
  const online = connected && !previewOffline;
  const [attempt, action, submitting] = useActionState(async (previous: { result: SignUpState; count: number }, data: FormData) => {
    const result = await signUpAction(previous.result, data);
    setPassword("");
    return { result, count: previous.count + 1 };
  }, { result: initialState, count: 0 });
  const pending = submitting || previewPending;
  const problem = attempt.result && !attempt.result.ok ? attempt.result : null;
  const errors = problem?.error === "invalid" ? problem.fieldErrors : {};
  const formRef = useRef<HTMLFormElement>(null);
  const strength = passwordStrength(password, email);
  const login = signupLink("/login", next);

  useEffect(() => {
    const update = () => setConnected(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  useEffect(() => {
    if (!problem || attempt.count === 0) return;
    const field = problem.error === "email-taken" || errors.email ? "email" : errors.firstName ? "name" : errors.phone ? "phone" : errors.terms ? "terms" : "password";
    formRef.current?.querySelector<HTMLInputElement>(`input[name="${field}"]`)?.focus();
  }, [attempt.count, problem, errors.email, errors.firstName, errors.phone, errors.terms]);

  const success = attempt.result?.ok && attempt.result.status === "check-email" ? attempt.result : null;

  return (
    <div data-mode="customer" className={styles.modeSwap}>
      <AuthLayout title="Create account" wideTitle art="mail" detailsStep backHref={signupLink("/signup", next)}
        aside={<>Already have an account? <Link href={login}>Log in</Link></>}>
        <div className={styles.detailsProgress} role="progressbar" aria-label="Sign-up progress" aria-valuemin={0} aria-valuemax={2} aria-valuenow={2} aria-valuetext="Step 2 of 2"><span /><span /></div>
        {success ? (
          <div className={styles.form}>
            <Banner tone="good" title="Confirm your email" live>Check {success.email} for your confirmation link. You can log in now; confirm your email before posting a job.</Banner>
            <Button href={login} width="full">Log in</Button>
          </div>
        ) : (
          <form ref={formRef} action={action} className={styles.form} noValidate aria-busy={pending}>
            <div className={styles.desktopChoices}><SignupRoleChoices role="customer" name="signupRole" onChange={(role) => { if (role !== "customer") router.push(detailsHref(role, next)); }} /></div>
            {!online && <Banner tone="alert" title="You’re offline." live>Your details are kept here. Connect to the internet to create your account.</Banner>}
            {problem?.error === "unavailable" && <Banner tone="alert" title="We can’t create your account right now." live>Your details are kept. Please try again.</Banner>}
            {problem?.error === "try-later" && <Banner tone="alert" title="Please try again shortly." live>Sign-up is busy right now. Your details are kept.</Banner>}
            {next?.startsWith("/jobs/new") && <p className={styles.draftNote}>Your job draft stays saved while you sign up. Confirm your email before posting it.</p>}
            <input type="hidden" name="role" value="CUSTOMER" />
            {next && <input type="hidden" name="next" value={next} />}
            <TextField name="name" label="Full name" placeholder="Full name" variant="underline" icon="person" autoComplete="name" required maxLength={161}
              className={styles.quietLabel} value={name} onChange={(event) => setName(event.target.value)} error={errors.firstName || errors.lastName} />
            <TextField name="email" label="Email" placeholder="Email" type="email" variant="underline" icon="mail" autoComplete="email" inputMode="email" spellCheck={false} required maxLength={254}
              className={styles.quietLabel} value={email} onChange={(event) => setEmail(event.target.value)}
              aria-describedby={problem?.error === "email-taken" ? "signup-email-options" : undefined}
              error={problem?.error === "email-taken" ? "That email is already in use." : errors.email} />
            {problem?.error === "email-taken" && <p id="signup-email-options" className={styles.passwordHint}><Link href={login}>Log in instead?</Link> Or <Link href={signupLink("/recovery", next)}>reset your password</Link>.</p>}
            <TextField name="phone" label="Mobile" placeholder="Mobile" type="tel" variant="underline" icon="call" autoComplete="tel" inputMode="tel" required maxLength={24}
              className={styles.quietLabel} value={phone} onChange={(event) => setPhone(event.target.value)} error={errors.phone} />
            <div className={styles.passwordGroup}>
              <PasswordField name="password" label="Password" placeholder="Password" autoComplete="new-password" required className={styles.quietLabel}
                value={password} onChange={(event) => setPassword(event.target.value)} error={errors.password} aria-describedby="signup-password-hint" />
              <div className={styles.strength} role="meter" aria-label="Password strength" aria-valuemin={0} aria-valuemax={4} aria-valuenow={strength.segments} aria-valuetext={strength.hint}>
                {[0, 1, 2, 3].map((segment) => <span key={segment} data-active={segment < strength.segments || undefined} />)}
              </div>
              <p id="signup-password-hint" className={styles.passwordHint}>{strength.hint}</p>
            </div>
            <CheckboxField key={`terms-${attempt.count}`} name="terms" label={<>I agree to the <Link href="/legal/terms" target="_blank" rel="noopener">Terms of use</Link> and <Link href="/legal/privacy" target="_blank" rel="noopener">Privacy Policy</Link></>}
              checked={terms} onChange={(event) => setTerms(event.target.checked)} error={errors.terms} required />
            <Button type="submit" width="full" loading={pending} disabled={!terms || !online} className={styles.submit}>Create account</Button>
            <p className={styles.phoneOnly}>Already have an account? <Link href={login}>Log in</Link></p>
          </form>
        )}
      </AuthLayout>
    </div>
  );
}
