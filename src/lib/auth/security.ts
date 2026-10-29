import { z } from "zod";

import { passwordMessage } from "./password";

export type SecurityOperation = "email" | "password" | "sessions";
export type SecurityField = "currentPassword" | "email" | "password" | "confirmPassword";
export type SecurityResult =
  | { ok: true; status: "email-sent" | "email-changed" | "password-changed" | "sessions-ended"; email?: string }
  | { ok: false; error: "invalid" | "wrong-password" | "session-expired" | "forbidden" | "try-later" | "unavailable" | "email-taken" | "reauthenticate" | "sessions-failed"; fields?: Partial<Record<SecurityField, string>> };

export type SecurityInput = { operation: SecurityOperation; currentPassword: string; email: string; password: string; confirmPassword: string };

export function readSecurityForm(operation: SecurityOperation, form: FormData): SecurityInput {
  const text = (name: string) => typeof form.get(name) === "string" ? String(form.get(name)) : "";
  return { operation, currentPassword: text("currentPassword"), email: text("email"), password: text("password"), confirmPassword: text("confirmPassword") };
}

export function validateSecurity(input: SecurityInput, email: string): SecurityResult | null {
  const fields: Partial<Record<SecurityField, string>> = {};
  if (!input.currentPassword) fields.currentPassword = "Enter your current password.";
  if (input.operation === "email") {
    if (!z.email().max(254).safeParse(input.email.trim()).success) fields.email = "Enter a valid email.";
    else if (input.email.trim().toLowerCase() === email.toLowerCase()) fields.email = "Enter a different email.";
  }
  if (input.operation === "password") {
    const problem = passwordMessage(input.password, email);
    if (problem) fields.password = problem;
    else if (input.password === input.currentPassword) fields.password = "Choose a different password.";
    if (input.password !== input.confirmPassword) fields.confirmPassword = "Passwords don’t match.";
  }
  return Object.keys(fields).length ? { ok: false, error: "invalid", fields } : null;
}

export const SECURITY_MESSAGES: Record<Exclude<Extract<SecurityResult, { ok: false }>["error"], "invalid">, string> = {
  "wrong-password": "That’s not your current password. Try again.",
  "session-expired": "Log in again to change your security settings.",
  forbidden: "You can’t change these settings with this account.",
  "try-later": "Too many tries. Try again shortly.",
  unavailable: "Couldn’t save that. Check your connection and try again.",
  "email-taken": "That email is already in use. Try another email.",
  reauthenticate: "Log in again, then retry this change.",
  "sessions-failed": "Password changed, but other devices couldn’t be logged out. Use Log out other devices below to try again.",
};
