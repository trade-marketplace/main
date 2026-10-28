"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { CheckboxField } from "@/components/forms/ChoiceFields";
import { PasswordField, TextField } from "@/components/forms/TextFields";
import { Banner } from "@/components/overlays/Banner";
import { passwordMessage } from "@/lib/auth/password";
import { normaliseMobile, passwordStrength, signupLink } from "@/lib/auth/signup";
import { parseWorkerSignup, readWorkerSignupForm } from "@/lib/auth/worker-signup";
import { signUpAction, type SignUpState } from "@/server/auth/actions";

import type { SignUpField } from "@/server/auth/account";
import type { SignupAreaSuggestion } from "@/server/auth/work-area";

import { AuthLayout } from "./AuthLayout";

import { WorkerSignupFields } from "./WorkerSignupFields";
import { detailsHref, SignupRoleChoices, type SignupRole } from "./SignupChoice";
import styles from "./auth.module.css";

export type CustomerSignupProps = { next?: string; initialState?: SignUpState; previewPending?: boolean; previewOffline?: boolean };

export function CustomerSignup(props: CustomerSignupProps) {
  return <SignupDetails {...props} role="customer" />;
}

export type SignupDetailsProps = CustomerSignupProps & { role: SignupRole; initialTradeStep?: boolean; previewAreaState?: "loading" | "unavailable"; previewAreaSuggestions?: SignupAreaSuggestion[] };

export function SignupDetails({ role, next, initialState = null, previewPending = false, previewOffline = false, initialTradeStep = false, previewAreaState, previewAreaSuggestions }: SignupDetailsProps) {
  const isTradie = role === "tradie";
  const [tradeStep, setTradeStep] = useState(initialTradeStep);
  const [stepErrors, setStepErrors] = useState<Partial<Record<SignUpField, string>>>({});
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
    if (isTradie && result && !result.ok) setTradeStep(false);
    return { result, count: previous.count + 1 };
  }, { result: initialState, count: 0 });
  const pending = submitting || previewPending;
  const problem = attempt.result && !attempt.result.ok ? attempt.result : null;
  const errors = { ...(problem?.error === "invalid" ? problem.fieldErrors : {}), ...stepErrors };
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

  const previousStep = useRef(tradeStep);
  useEffect(() => {
    if (previousStep.current === tradeStep) return;
    previousStep.current = tradeStep;
    formRef.current?.querySelector<HTMLInputElement>(tradeStep ? 'input[name="trades"]' : 'input[name="name"]')?.focus();
  }, [tradeStep]);

  const firstLicenceError = ["ELECTRICAL", "PLUMBING", "GAS", "CONSTRUCTION"].map((trade) => `licence_${trade}` as SignUpField).find((field) => errors[field]);
  const focusField = problem?.error === "email-taken" || errors.email ? "email" : errors.firstName || errors.lastName ? "name" : errors.phone ? "phone" : errors.terms ? "terms" : errors.trades ? "trades" : errors.baseSuburb ? "baseSuburb" : errors.radiusKm ? "radiusKm" : firstLicenceError || "password";
  useEffect(() => {
    if (!problem || attempt.count === 0) return;
    formRef.current?.querySelector<HTMLInputElement>(`input[name="${focusField}"]`)?.focus();
  }, [attempt.count, problem, focusField]);

  const success = attempt.result?.ok && attempt.result.status === "check-email" ? attempt.result : null;

  return (
    <div data-mode={isTradie ? "trade" : "customer"} className={`${styles.modeSwap}${isTradie ? " tm-anim-rise" : ""}`}>
      <AuthLayout title={isTradie && tradeStep ? "Your trade" : "Create account"} wideTitle art={isTradie ? "phone" : "mail"} detailsStep backHref={signupLink("/signup", next)}
        onBack={isTradie && tradeStep ? () => setTradeStep(false) : undefined}
        stepLabel={isTradie ? `Step ${tradeStep ? 3 : 2} of 3` : "Step 2 of 2"} eyebrow={isTradie && tradeStep ? "Step 2 of 2" : undefined}
        brandTitle={isTradie ? "You do the work. We find the jobs." : undefined}
        aside={<><Link href={login}>Log in</Link></>}>
        <div className={styles.detailsProgress} role="progressbar" aria-label="Sign-up progress" aria-valuemin={0} aria-valuemax={isTradie ? 3 : 2} aria-valuenow={isTradie && tradeStep ? 3 : 2} aria-valuetext={isTradie ? `Step ${tradeStep ? 3 : 2} of 3` : "Step 2 of 2"}>
          {Array.from({ length: isTradie ? 3 : 2 }, (_, index) => <span key={index} data-active={index < (isTradie && tradeStep ? 3 : 2) || undefined} />)}
        </div>
        {success ? (
          <div className={styles.form}>
            <Banner tone="good" title="Confirm your email" live>{success.email}</Banner>
            <Button href={login} width="full">Log in</Button>
          </div>
        ) : (
          <form ref={formRef} action={action} className={styles.form} noValidate aria-busy={pending} onSubmit={(event) => {
            if (!isTradie) return;
            if (tradeStep) {
              const checked = parseWorkerSignup(readWorkerSignupForm(new FormData(event.currentTarget)));
              if (!checked.ok) {
                event.preventDefault();
                setStepErrors(checked.errors);
                const field = Object.keys(checked.errors)[0];
                formRef.current?.querySelector<HTMLInputElement>(`input[name="${field}"]`)?.focus();
              } else setStepErrors({});
              return;
            }
            event.preventDefault();
            const invalid: Partial<Record<SignUpField, string>> = {};
            const parts = name.trim().split(/\s+/);
            if (!parts[0] || parts[0].length > 80 || parts.slice(1).join(" ").length > 80) invalid.firstName = "Enter your name.";
            if (!formRef.current?.querySelector<HTMLInputElement>('input[name="email"]')?.validity.valid || !email.trim()) invalid.email = "Enter a valid email.";
            if (!normaliseMobile(phone)) invalid.phone = "New Zealand mobile required.";
            const weak = passwordMessage(password, email);
            if (weak) invalid.password = weak;
            setStepErrors(invalid);
            if (!Object.keys(invalid).length) setTradeStep(true);
            else formRef.current?.querySelector<HTMLInputElement>(`input[name="${invalid.firstName ? "name" : invalid.email ? "email" : invalid.phone ? "phone" : "password"}"]`)?.focus();
          }}>
            {!tradeStep && <div className={styles.desktopChoices}><SignupRoleChoices role={role} name="signupRole" onChange={(choice) => { if (choice !== role) router.push(detailsHref(choice, next)); }} /></div>}
            {!online && <Banner tone="alert" title="Offline." live />}
            {problem?.error === "unavailable" && <Banner tone="alert" title="Sign-up unavailable. Try again." live />}
            {problem?.error === "try-later" && <Banner tone="alert" title="Try again shortly." live />}
            <input type="hidden" name="role" value={isTradie ? "TRADIE" : "CUSTOMER"} />
            {next && <input type="hidden" name="next" value={next} />}
            <div className={styles.accountFields} hidden={isTradie && tradeStep}>
            <TextField name="name" label="Full name" placeholder="Full name" variant="underline" icon="person" autoComplete="name" required maxLength={161}
              className={styles.quietLabel} value={name} onChange={(event) => setName(event.target.value)} error={errors.firstName || errors.lastName} />
            <TextField name="email" label="Email" placeholder="Email" type="email" variant="underline" icon="mail" autoComplete="email" inputMode="email" spellCheck={false} required maxLength={254}
              className={styles.quietLabel} value={email} onChange={(event) => setEmail(event.target.value)}
              aria-describedby={problem?.error === "email-taken" ? "signup-email-options" : undefined}
              error={problem?.error === "email-taken" ? "Email already in use." : errors.email} />
            {problem?.error === "email-taken" && <p id="signup-email-options" className={styles.passwordHint}><Link href={signupLink("/recovery", next)}>Reset password</Link></p>}
            <TextField name="phone" label="Mobile" placeholder="Mobile" type="tel" variant="underline" icon="call" autoComplete="tel" inputMode="tel" required maxLength={24}
              className={styles.quietLabel} value={phone} onChange={(event) => setPhone(event.target.value)} error={errors.phone} />
            <div className={styles.passwordGroup}>
              <PasswordField name="password" label="Password" placeholder="Password" autoComplete="new-password" required className={styles.quietLabel}
                value={password} onChange={(event) => setPassword(event.target.value)} error={errors.password} aria-describedby="signup-password-hint" />
              <div className={styles.strength} role="meter" aria-label="Password strength" aria-valuemin={0} aria-valuemax={4} aria-valuenow={strength.segments} aria-valuetext={strength.hint}>
                {[0, 1, 2, 3].map((segment) => <span key={segment} data-active={segment < strength.segments || undefined} />)}
              </div>
              <p id="signup-password-hint" hidden>{strength.hint}</p>
            </div>
            </div>
            {isTradie && <div className={`${styles.tradeStepFields} tm-anim-rise`} hidden={!tradeStep}><WorkerSignupFields values={problemAtStart?.values} errors={errors} attempt={attempt.count} previewAreaState={previewAreaState} previewSuggestions={previewAreaSuggestions} /></div>}
            <div hidden={isTradie && !tradeStep} className={styles.consent}>
            <CheckboxField key={`terms-${attempt.count}`} name="terms" label={<>I agree to <Link href={isTradie ? "/legal/tradie-terms" : "/legal/terms"} target="_blank" rel="noopener">{isTradie ? "Worker terms" : "Terms"}</Link> and <Link href="/legal/privacy" target="_blank" rel="noopener">Privacy</Link></>}
              checked={terms} onChange={(event) => setTerms(event.target.checked)} error={errors.terms} required />
            </div>
            <Button type="submit" width="full" loading={pending} disabled={!online || (!isTradie || tradeStep) && !terms} className={styles.submit}>{isTradie ? tradeStep ? "Finish sign-up" : "Next" : "Create account"}</Button>
            {isTradie && tradeStep && <Button type="button" variant="tertiary" width="full" onClick={() => setTradeStep(false)}>Back</Button>}
            <p className={styles.phoneOnly}><Link href={login}>Log in</Link></p>
          </form>
        )}
      </AuthLayout>
    </div>
  );
}
