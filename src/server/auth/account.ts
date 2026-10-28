import "server-only";

import { z } from "zod";

import { PASSWORD_MESSAGES, passwordMessage } from "@/lib/auth/password";
import { afterLoginPath } from "@/lib/auth/routes";
import { normaliseMobile } from "@/lib/auth/signup";
import { parseWorkerSignup, readWorkerSignupForm, workerSignupValues, type WorkerSignupDetails, type WorkerSignupField, type WorkerSignupInput } from "@/lib/auth/worker-signup";
import { SupabaseNotConfiguredError } from "@/lib/supabase/config";
import type { Role } from "@/lib/mode";
import type { ProfileRow } from "@/server/auth/viewer";
import { DatabaseNotConfiguredError } from "@/server/db";

// Sign up, log in and log out (#101), written against small interfaces so tests can pass fakes instead of
// Supabase and the database. The server actions in ./actions.ts plug in the real ones.
// Supabase Auth owns passwords and sessions (DECISIONS.md, #60); we own the `profiles` row and the role.

// ---------------------------------------------------------------- what we need from Supabase and the database

type AuthErrorLike = { message: string; code?: string; status?: number };

export type AuthUserLike = {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown>;
  /** Empty when Supabase hides that the email is already registered (email confirmation on). */
  identities?: unknown[] | null;
};

type AuthResponseLike = {
  data: { user: AuthUserLike | null; session: unknown };
  error: AuthErrorLike | null;
};

export type AuthClient = {
  signUp(credentials: {
    email: string;
    password: string;
    options?: { data?: Record<string, unknown> };
  }): Promise<AuthResponseLike>;
  signInWithPassword(credentials: { email: string; password: string }): Promise<AuthResponseLike>;
  signOut(options?: { scope?: "global" | "local" | "others" }): Promise<{ error: AuthErrorLike | null }>;
};

export type NewProfile = {
  id: string;
  email: string;
  role: Role;
  firstName: string;
  lastName: string | null;
  phone?: string | null;
  emailVerifiedAt: Date | null;
};

export type ProfileStore = {
  find(id: string): Promise<ProfileRow | null>;
  create(profile: NewProfile): Promise<ProfileRow>;
  markEmailVerified(id: string, at: Date): Promise<ProfileRow>;
  /** Creates pending worker details once. Never changes existing verification or licence decisions. */
  ensureWorker?(id: string, details: WorkerSignupDetails): Promise<void>;
};

export type AccountDeps = { auth: AuthClient; profiles: ProfileStore };

// ---------------------------------------------------------------- results

type FieldErrors<Field extends string> = Partial<Record<Field, string>>;

export type SignUpField = "email" | "password" | "firstName" | "lastName" | "role" | "phone" | "terms" | WorkerSignupField;
type LogInField = "email" | "password";

/**
 * - `signed-in`: email confirmation is off in Supabase, so they're in; go to `redirectTo`.
 * - `check-email`: Supabase sent a confirmation email; show "check your inbox" (verify email, #106).
 * - `invalid`: a field is wrong (`fieldErrors`). `email-taken`: offer "Log in instead?" (#104).
 * - `try-later`: Supabase's rate limit. `unavailable`: sign-in isn't set up, or Supabase/the database failed.
 * `values` are the fields to put back in the form (never the password).
 */
export type SignUpResult =
  | { ok: true; status: "signed-in"; role: Role; redirectTo: string }
  | { ok: true; status: "check-email"; email: string }
  | { ok: false; error: "invalid"; fieldErrors: FieldErrors<SignUpField>; values: Record<string, string> }
  | { ok: false; error: "email-taken" | "try-later" | "unavailable"; values: Record<string, string> };

/**
 * - `wrong-credentials`: one message for a wrong email or a wrong password, so it doesn't reveal who has an
 *   account. Accounts are never locked after wrong passwords (Matt, DECISIONS.md).
 * - `email-not-verified`: Supabase refuses log-in until the email is confirmed (a project setting; #102 wants
 *   log-in to work with a "please verify" banner instead).
 */
export type LogInResult =
  | { ok: true; role: Role; redirectTo: string }
  | { ok: false; error: "invalid"; fieldErrors: FieldErrors<LogInField>; values: { email: string } }
  | {
      ok: false;
      error: "wrong-credentials" | "email-not-verified" | "try-later" | "unavailable";
      values: { email: string };
    };

// ---------------------------------------------------------------- input

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter your email.")
  .max(254, "That email address is too long.")
  .pipe(z.email("Enter a valid email."));

const signUpSchema = z.object({
  email: emailField,
  // Not trimmed: spaces are allowed in passwords and must not be changed behind the person's back.
  password: z.string(),
  firstName: z.string().trim().min(1, "Enter your first name.").max(80, "Name too long."),
  lastName: z.string().trim().max(80, "Name too long."),
  // Only customers and tradies can sign up. Office (ADMIN) accounts are only ever made by a founder.
  role: z.enum(["CUSTOMER", "TRADIE"], "Choose customer or tradie."),
  phone: z.string().transform(normaliseMobile).refine((phone) => phone !== null, "Enter a mobile, like 021 555 0192."),
  terms: z.literal(true, "Accept the terms."),
});

/** Raw form text: everything is checked by signUpSchema before use. */
export type SignUpInput = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: string;
  phone: string;
  terms: boolean;
  worker?: WorkerSignupInput;
  next?: string;
};

export function readSignUpForm(formData: FormData): SignUpInput {
  const fullName = text(formData, "name").trim().split(/\s+/);
  return {
    email: text(formData, "email"),
    password: text(formData, "password"),
    firstName: text(formData, "firstName") || fullName[0] || "",
    lastName: text(formData, "lastName") || fullName.slice(1).join(" "),
    phone: text(formData, "phone"),
    terms: text(formData, "terms") === "on",
    role: text(formData, "role") || "CUSTOMER",
    ...(text(formData, "role") === "TRADIE" ? { worker: readWorkerSignupForm(formData) } : {}),
    next: text(formData, "next"),
  };
}

const logInSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Enter a password."),
});

export type LogInInput = { email: string; password: string; next?: string };

export function readLogInForm(formData: FormData): LogInInput {
  return { email: text(formData, "email"), password: text(formData, "password"), next: text(formData, "next") };
}

function fieldErrorsOf<Field extends string>(error: z.ZodError): FieldErrors<Field> {
  const errors: FieldErrors<Field> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0]) as Field;
    errors[field] ??= issue.message;
  }
  return errors;
}

// ---------------------------------------------------------------- profiles

function metadataText(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/**
 * The person's profile, created if it's missing, with `email_verified_at` copied from Supabase once they've
 * confirmed. Sign-up creates the profile straight away; this also repairs one whose sign-up was cut off between
 * Supabase creating the user and us saving the profile. The role then comes from what they picked at sign-up
 * (kept in Supabase's user metadata), and can only be CUSTOMER or TRADIE, never ADMIN.
 */
export async function ensureProfile(
  profiles: ProfileStore,
  user: AuthUserLike,
  fallback: Partial<Pick<NewProfile, "role" | "firstName" | "lastName" | "phone">> = {},
  worker?: WorkerSignupDetails,
): Promise<ProfileRow> {
  const confirmedAt = user.email_confirmed_at ? new Date(user.email_confirmed_at) : null;
  let profile = await profiles.find(user.id);
  if (!profile) {
    const email = user.email ?? "";
    const metadataRole = metadataText(user.user_metadata, "role");
    try {
      profile = await profiles.create({
        id: user.id,
        email,
        role: fallback.role ?? (metadataRole === "TRADIE" ? "TRADIE" : "CUSTOMER"),
        firstName: fallback.firstName ?? metadataText(user.user_metadata, "first_name") ?? email.split("@")[0],
        lastName: fallback.lastName ?? metadataText(user.user_metadata, "last_name"),
        phone: fallback.phone ?? normaliseMobile(metadataText(user.user_metadata, "phone") ?? ""),
        emailVerifiedAt: confirmedAt,
      });
    } catch (error) {
      // Two requests raced to create it (e.g. log-in in two tabs): use the one that won.
      if (!isUniqueViolation(error)) throw error;
      profile = await profiles.find(user.id);
      if (!profile) throw error;
    }
  }
  if (confirmedAt && !profile.emailVerifiedAt) profile = await profiles.markEmailVerified(user.id, confirmedAt);
  if (profile.role === "TRADIE") {
    const fromMetadata = parseWorkerSignup(user.user_metadata?.worker_signup);
    const details = worker ?? (fromMetadata.ok ? fromMetadata.details : null);
    if (details) {
      if (!profiles.ensureWorker) throw new Error("Worker profile storage is unavailable");
      await profiles.ensureWorker(user.id, details);
    }
  }
  return profile;
}

function isNotConfigured(error: unknown): boolean {
  return error instanceof SupabaseNotConfiguredError || error instanceof DatabaseNotConfiguredError;
}

// ---------------------------------------------------------------- sign up, log in, log out

export async function signUp(deps: AccountDeps, input: SignUpInput): Promise<SignUpResult> {
  const values = { email: input.email.trim(), firstName: input.firstName, lastName: input.lastName, role: input.role, phone: input.phone, terms: input.terms ? "on" : "", ...(input.role === "TRADIE" ? workerSignupValues(input.worker) : {}) };
  const parsed = signUpSchema.safeParse(input);
  const fieldErrors: FieldErrors<SignUpField> = parsed.success ? {} : fieldErrorsOf<SignUpField>(parsed.error);
  const weak = passwordMessage(input.password, parsed.success ? parsed.data.email : input.email);
  if (weak) fieldErrors.password ??= weak;
  const worker = input.role === "TRADIE" ? parseWorkerSignup(input.worker) : null;
  if (worker && !worker.ok) Object.assign(fieldErrors, worker.errors);
  if (!parsed.success || Object.keys(fieldErrors).length > 0) {
    return { ok: false, error: "invalid", fieldErrors, values };
  }
  const { email, password, firstName, role, phone } = parsed.data;
  const lastName = parsed.data.lastName || null;

  let response: AuthResponseLike;
  try {
    response = await deps.auth.signUp({
      email,
      password,
      // Kept by Supabase with the user, so a profile can be rebuilt if saving it below fails (ensureProfile).
      options: { data: { first_name: firstName, last_name: lastName, role, phone, terms_accepted: true, ...(worker?.ok ? { worker_signup: worker.details } : {}) } },
    });
  } catch {
    return { ok: false, error: "unavailable", values };
  }
  const { data, error } = response;
  if (error) {
    if (error.code === "user_already_exists" || error.code === "email_exists") {
      return { ok: false, error: "email-taken", values };
    }
    if (error.code === "weak_password") {
      return { ok: false, error: "invalid", fieldErrors: { password: PASSWORD_MESSAGES.common }, values };
    }
    if (error.code?.startsWith("over_") || error.status === 429) return { ok: false, error: "try-later", values };
    console.error(`Sign-up failed: ${error.message}`);
    return { ok: false, error: "unavailable", values };
  }
  // With email confirmation on, Supabase answers a sign-up for a registered email with a stand-in user that has
  // no identities (and sends that person a "someone tried to sign up" email) instead of an error.
  if (!data.user || (Array.isArray(data.user.identities) && data.user.identities.length === 0)) {
    return { ok: false, error: "email-taken", values };
  }

  try {
    await ensureProfile(deps.profiles, data.user, { role, firstName, lastName, phone }, worker?.ok ? worker.details : undefined);
  } catch (profileError) {
    console.error("Sign-up: saving the profile failed; it will be created on first log-in.", profileError);
    return { ok: false, error: "unavailable", values };
  }

  if (!data.session) return { ok: true, status: "check-email", email };
  return { ok: true, status: "signed-in", role, redirectTo: afterLoginPath(role, input.next) };
}

export async function logIn(deps: AccountDeps, input: LogInInput): Promise<LogInResult> {
  const values = { email: input.email.trim() };
  const parsed = logInSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: fieldErrorsOf<LogInField>(parsed.error), values };
  }

  const { data, error } = await deps.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    if (error?.code === "invalid_credentials") return { ok: false, error: "wrong-credentials", values };
    if (error?.code === "email_not_confirmed") return { ok: false, error: "email-not-verified", values };
    if (error?.code?.startsWith("over_") || error?.status === 429) return { ok: false, error: "try-later", values };
    console.error(`Log-in failed: ${error?.message ?? "no user returned"}`);
    return { ok: false, error: "unavailable", values };
  }

  let profile: ProfileRow;
  try {
    profile = await ensureProfile(deps.profiles, data.user);
  } catch (profileError) {
    // Don't leave a session behind that the app can't use.
    await deps.auth.signOut({ scope: "local" });
    if (!isNotConfigured(profileError)) console.error("Log-in: reading the profile failed.", profileError);
    return { ok: false, error: "unavailable", values };
  }
  return { ok: true, role: profile.role, redirectTo: afterLoginPath(profile.role, input.next) };
}

/**
 * Ends this browser's session ("log out other devices" is #113). Clears the cookies even if the session had
 * already expired on Supabase's side.
 */
export async function logOut(auth: AuthClient): Promise<void> {
  const { error } = await auth.signOut({ scope: "local" });
  if (error) console.warn(`Log-out: ${error.message} (cookies cleared anyway)`);
}
