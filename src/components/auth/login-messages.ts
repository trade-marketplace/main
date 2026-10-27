// What the log-in form says for each answer from logInAction (#102). Safe on server and browser.
// One message for a wrong email or a wrong password, so the form never says who has an account (#101).
import type { LogInResult } from "@/server/auth/account";

export type LogInProblem = Exclude<LogInResult, { ok: true }>;

export type LogInMessages = {
  /** Under the email field. */
  email?: string;
  /** Under the password field (and the password field turns red). */
  password?: string;
  /** A banner over the form, for problems that aren't about one field. */
  banner?: { tone: "alert" | "info"; title: string; text: string };
};

export const LOGIN_MESSAGES = {
  wrongCredentials: "That email and password don’t match. Try again or reset it.",
  // Only when Supabase's own rate limit answers: accounts are never locked after wrong passwords (DECISIONS.md).
  // The wait isn't promised: it depends on the limit.
  locked: { title: "Too many tries.", text: "Wait a few minutes, or reset your password." },
  notVerified: { title: "Confirm your email first.", text: "Open the link we emailed you, then log in." },
  unavailable: { title: "We can’t log you in right now.", text: "Try again in a minute." },
} as const;

export function logInMessages(result: LogInProblem | null): LogInMessages {
  if (!result) return {};
  switch (result.error) {
    case "invalid":
      return { email: result.fieldErrors.email, password: result.fieldErrors.password };
    case "wrong-credentials":
      return { password: LOGIN_MESSAGES.wrongCredentials };
    case "try-later":
      return { banner: { tone: "alert", ...LOGIN_MESSAGES.locked } };
    case "email-not-verified":
      return { banner: { tone: "info", ...LOGIN_MESSAGES.notVerified } };
    case "unavailable":
      return { banner: { tone: "alert", ...LOGIN_MESSAGES.unavailable } };
  }
}
