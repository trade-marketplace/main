"use client";
// The log-in form (#102): pages.html w-login, screens.html pub-login. Underline fields with icons, show/hide
// password, Keep me logged in, Forgot password?, Log in (Enter submits), or, Create an account ("Sign up" on a phone).
// The fields show placeholders, as in the mockup; their labels are there for screen readers only (Matt, #340).
// After a failed try the email stays and the password is cleared, and focus goes to what needs fixing.
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";

import { Button } from "@/components/Button";
import { CheckboxField } from "@/components/forms/ChoiceFields";
import { PasswordField, TextField } from "@/components/forms/TextFields";
import { Banner } from "@/components/overlays/Banner";
import { logInAction, type LogInState } from "@/server/auth/actions";

import { logInMessages } from "./login-messages";
import styles from "./auth.module.css";

export type LoginFormProps = {
  /** Where to go after logging in (?next=). Checked again on the server: only our own pages. */
  next?: string;
  /** Previews only: start as if a try had already come back with this answer. */
  initialState?: LogInState;
};

type Attempt = { result: LogInState; count: number };

export function LoginForm({ next, initialState = null }: LoginFormProps) {
  // Each try is numbered, so the fields re-mount after every answer: the email shows what was sent and the
  // password is emptied. (A successful log-in redirects from the server and never comes back here.)
  const [attempt, formAction, pending] = useActionState(
    async (previous: Attempt, formData: FormData): Promise<Attempt> => ({
      result: await logInAction(previous.result, formData),
      count: previous.count + 1,
    }),
    { result: initialState, count: 0 },
  );
  const state = attempt.result;
  const problem = state && !state.ok ? state : null;
  const messages = logInMessages(problem);
  const email = problem?.values.email ?? "";
  const formRef = useRef<HTMLFormElement>(null);

  // After a failed try, put focus where the fix is: the email if it's wrong, else the (emptied) password.
  useEffect(() => {
    if (!problem || attempt.count === 0) return;
    const form = formRef.current;
    const target = messages.email ? form?.querySelector<HTMLInputElement>("input[name=email]") : form?.querySelector<HTMLInputElement>("input[name=password]");
    target?.focus();
  }, [problem, attempt.count, messages.email]);

  const signUpHref = next ? `/signup?next=${encodeURIComponent(next)}` : "/signup";

  return (
    <form ref={formRef} action={formAction} className={styles.form} noValidate aria-describedby={messages.banner ? "login-banner" : undefined}>
      {messages.banner && (
        <div id="login-banner">
          <Banner tone={messages.banner.tone} title={messages.banner.title} live>
            {messages.banner.text}
          </Banner>
        </div>
      )}
      {next && <input type="hidden" name="next" value={next} />}
      <TextField
        variant="underline"
        icon="mail"
        type="email"
        name="email"
        label="Email"
        placeholder="Email"
        className={styles.quietLabel}
        autoComplete="email"
        inputMode="email"
        spellCheck={false}
        defaultValue={email}
        key={`email-${attempt.count}`}
        error={messages.email}
      />
      <PasswordField
        name="password"
        label="Password"
        placeholder="Password"
        className={styles.quietLabel}
        autoComplete="current-password"
        key={`password-${attempt.count}`}
        error={messages.password}
      />
      <div className={styles.row}>
        <CheckboxField name="remember" label="Keep me logged in" defaultChecked className={styles.remember} />
        <Link href="/recovery" className={styles.forgot}>
          Forgot password?
        </Link>
      </div>
      <Button type="submit" width="full" loading={pending} className={styles.submit}>
        Log in
      </Button>
      <p className={styles.or}>
        <span aria-hidden="true" />
      </p>
      {/* The same short alternate action on phone and desktop. */}
      <Button href={signUpHref} variant="secondary" width="full">
        <span className={styles.wideOnly}>Sign up</span>
        <span className={styles.narrowOnly}>Sign up</span>
      </Button>
    </form>
  );
}
