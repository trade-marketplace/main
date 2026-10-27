"use client";
// The session-expired dialog (B07, #108): mockup w-modals (“Dialogs”) in docs/design/pages.html. When a protected
// server action answers `session-expired` (src/lib/auth/results.ts), the page shows this over itself instead of
// leaving: “You’ve been logged out” → Log in again → email and password, right here. Logging in keeps the page
// and whatever was typed, then sends the form that failed again. Esc, the scrim and swiping do nothing.
// How to use it: docs/components/session-expired.md. Every state, live: /dev/components/session-expired.
//
//   <SessionExpiredProvider logIn={logInAgainAction} email={viewer.email} role={viewer.role}>  (the shells do this)
//   const sessionExpired = useSessionExpired();
//   const result = await saveDraft(formData);
//   if (sessionExpired.check(result, { resend: () => saveDraft(formData) })) return;
import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useActionState,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { TextLink } from "@/components/TextLink";
import { PasswordField, TextField } from "@/components/forms";
import { Banner, Dialog } from "@/components/overlays";
import { homeForRole } from "@/lib/auth/routes";
import { isSessionExpired } from "@/lib/auth/results";
import type { Role } from "@/lib/mode";
import type { LogInResult } from "@/server/auth/account";

import styles from "./session-expired.module.css";

export type LogInAgainState = LogInResult | null;

/** logInAgainAction (src/server/auth/actions.ts), or a stand-in in previews and tests. */
export type LogInAgain = (previous: LogInAgainState, formData: FormData) => Promise<LogInAgainState>;

export const SESSION_EXPIRED_COPY = {
  title: "You’ve been logged out",
  text: "For your security. Log in again and you’ll be right back here.",
  draft: "Your draft is saved.",
  start: "Log in again",
  submit: "Log in",
  notYou: "Not you? Log in as someone else",
} as const;

// The same words as the log-in page (#102), so a wrong password reads the same wherever it happens.
export const LOG_IN_AGAIN_MESSAGES = {
  wrongCredentials: "That email and password don’t match. Try again.",
  locked: { title: "Too many tries.", text: "Wait a few minutes, then try again." },
  notVerified: { title: "Confirm your email first.", text: "Open the link we emailed you, then log in." },
  unavailable: { title: "We can’t log you in right now.", text: "Try again in a minute." },
} as const;

type Problem = Exclude<LogInResult, { ok: true }>;

/** What the form shows for each answer: a message under a field, or a banner over the form. */
export function logInAgainMessages(result: LogInAgainState): {
  email?: string;
  password?: string;
  banner?: { tone: "alert" | "info"; title: string; text: string };
} {
  if (!result || result.ok) return {};
  const problem: Problem = result;
  switch (problem.error) {
    case "invalid":
      return { email: problem.fieldErrors.email, password: problem.fieldErrors.password };
    case "wrong-credentials":
      return { password: LOG_IN_AGAIN_MESSAGES.wrongCredentials };
    case "try-later":
      return { banner: { tone: "alert", ...LOG_IN_AGAIN_MESSAGES.locked } };
    case "email-not-verified":
      return { banner: { tone: "info", ...LOG_IN_AGAIN_MESSAGES.notVerified } };
    case "unavailable":
      return { banner: { tone: "alert", ...LOG_IN_AGAIN_MESSAGES.unavailable } };
  }
}

/**
 * After logging in again: stay on this page and send the form again, or, if a different kind of account logged
 * in (a tradie on a customer page), go to their home instead and send nothing, since the draft isn't theirs.
 */
export function afterLogInAgain(loggedInAs: Role, expected: Role | undefined): { stay: true } | { stay: false; goTo: string } {
  if (!expected || loggedInAs === expected) return { stay: true };
  return { stay: false, goTo: homeForRole(loggedInAs) };
}

// ---------------------------------------------------------------- the dialog

export type SessionExpiredStep = "notice" | "form";

export type SessionExpiredDialogProps = {
  open: boolean;
  logIn: LogInAgain;
  /** Called once the person is logged in again, with the answer from `logIn`. Close the dialog here. */
  onLoggedIn: (result: Extract<LogInResult, { ok: true }>) => void;
  /** Who was logged in. The form logs in as them (only the password is asked for); without it, email too. */
  email?: string;
  /** Say “Your draft is saved.” Default true: the dialog is nearly always over a form that was just sent. */
  draft?: boolean;
  /** Previews only: open on the form, with this answer already showing. */
  initialStep?: SessionExpiredStep;
  initialState?: LogInAgainState;
};

export function SessionExpiredDialog({
  open,
  logIn,
  onLoggedIn,
  email,
  draft = true,
  initialStep = "notice",
  initialState = null,
}: SessionExpiredDialogProps) {
  const [step, setStep] = useState<SessionExpiredStep>(initialStep);
  const [state, formAction, pending] = useActionState<LogInAgainState, FormData>(async (previous, formData) => {
    const result = await logIn(previous, formData);
    if (result?.ok) onLoggedIn(result);
    return result;
  }, initialState);
  const formId = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const messages = logInAgainMessages(state);
  // React clears a form after it's sent; put the email back (the password is never kept).
  const typedEmail = state && !state.ok ? state.values.email : "";

  // The “Log in again” button is gone once the form shows: move focus to the first field that needs typing.
  const focusField = useRef(false);
  useEffect(() => {
    if (step !== "form" || !focusField.current) return;
    focusField.current = false;
    (email ? passwordRef : emailRef).current?.focus();
  }, [step, email]);

  // A wrong password: back to the password field (empty), so it can be typed again straight away.
  const answered = useRef(state);
  useEffect(() => {
    if (state === answered.current) return;
    answered.current = state;
    if (state && !state.ok && (messages.password || messages.email))
      (messages.email ? emailRef : passwordRef).current?.focus();
  }, [state, messages.email, messages.password]);

  const description = `${SESSION_EXPIRED_COPY.text}${draft ? ` ${SESSION_EXPIRED_COPY.draft}` : ""}`;

  return (
    <Dialog
      open={open}
      dismissible={false}
      size="sm"
      phoneLayout="dialog"
      className={styles.dialog}
      eyebrow={
        <span className={styles.tile}>
          <Icon name="lock_clock" decorative className={styles.tileIcon} />
        </span>
      }
      title={SESSION_EXPIRED_COPY.title}
      description={description}
      footer={
        // Separate keys: if React reused the same <button>, the click on “Log in again” would also submit the
        // (empty) form, because it has become the submit button by the time the browser acts on the click.
        step === "notice" ? (
          <Button key="start" size="sm" width="full" onClick={() => ((focusField.current = true), setStep("form"))}>
            {SESSION_EXPIRED_COPY.start}
          </Button>
        ) : (
          <Button key="submit" size="sm" width="full" type="submit" form={formId} loading={pending}>
            {SESSION_EXPIRED_COPY.submit}
          </Button>
        )
      }
    >
      {step === "form" && (
        <form id={formId} action={formAction} noValidate className={styles.form} aria-label={SESSION_EXPIRED_COPY.start}>
          {messages.banner && (
            <Banner tone={messages.banner.tone} title={messages.banner.title} live>
              {messages.banner.text}
            </Banner>
          )}
          {email ? (
            <p className={styles.who}>
              Logging in as <strong>{email}</strong>
              {/* For password managers: which account this password is for. */}
              <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
            </p>
          ) : (
            <TextField
              ref={emailRef}
              key={`email-${typedEmail}`}
              label="Email"
              name="email"
              type="email"
              autoComplete="username"
              defaultValue={typedEmail}
              error={messages.email}
              required
            />
          )}
          <PasswordField
            ref={passwordRef}
            label="Password"
            name="password"
            autoComplete="current-password"
            error={messages.password}
            required
          />
          {email && (
            <TextLink href="/login" className={styles.notYou}>
              {SESSION_EXPIRED_COPY.notYou}
            </TextLink>
          )}
        </form>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- the provider

export type SessionExpiredOptions = {
  /** Run once they're logged in again: usually sends the form that failed again. */
  resend?: () => unknown;
  /** Say “Your draft is saved.” Default true. */
  draft?: boolean;
};

export type SessionExpiredApi = {
  /** If `result` is `session-expired`, shows the dialog and returns true. Otherwise returns false. */
  check: (result: unknown, options?: SessionExpiredOptions) => boolean;
  /** Shows the dialog (e.g. a fetch answered 401). Only one at a time: a second call while it shows is ignored. */
  show: (options?: SessionExpiredOptions) => void;
};

const SessionExpiredContext = createContext<SessionExpiredApi | null>(null);

/** The session-expired dialog's functions. Needs a <SessionExpiredProvider> above it (every shell has one). */
export function useSessionExpired(): SessionExpiredApi {
  const api = useContext(SessionExpiredContext);
  if (!api) throw new Error("useSessionExpired() needs a <SessionExpiredProvider> around it.");
  return api;
}

export type SessionExpiredProviderProps = {
  children: ReactNode;
  logIn: LogInAgain;
  /** The signed-in person's email and role, from the server. */
  email?: string;
  role?: Role;
};

/** `round` counts openings: each one gets a fresh form (no old password or error from last time). */
type Showing = SessionExpiredOptions & { open: boolean; round: number };

export function SessionExpiredProvider({ children, logIn, email, role }: SessionExpiredProviderProps) {
  const router = useRouter();
  const [showing, setShowing] = useState<Showing>({ open: false, round: 0 });
  const [api] = useState<SessionExpiredApi>(() => {
    const show = (options: SessionExpiredOptions = {}) =>
      setShowing((current) => (current.open ? current : { ...options, open: true, round: current.round + 1 }));
    return {
      show,
      check: (result, options) => {
        if (!isSessionExpired(result)) return false;
        show(options);
        return true;
      },
    };
  });

  const loggedIn = (result: Extract<LogInResult, { ok: true }>) => {
    const done = showing;
    setShowing((current) => ({ open: false, round: current.round }));
    const next = afterLogInAgain(result.role, role);
    if (!next.stay) {
      router.push(next.goTo);
      return;
    }
    // The server components re-read the new session; this page's own state (the draft) stays as it is.
    router.refresh();
    done.resend?.();
  };

  return (
    <SessionExpiredContext.Provider value={api}>
      {children}
      <SessionExpiredDialog
        key={showing.round}
        open={showing.open}
        logIn={logIn}
        onLoggedIn={loggedIn}
        email={email}
        draft={showing.draft ?? true}
      />
    </SessionExpiredContext.Provider>
  );
}
