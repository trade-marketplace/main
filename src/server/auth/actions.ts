"use server";

// The sign-up, log-in and log-out server actions (#101). The log-in and sign-up pages (#102–#105) and the
// session-expired dialog (#108) call these; the logic lives in ./account.ts.
//
// CSRF: server actions only run on POST, Next.js refuses one whose Origin isn't this site's host, and the session
// cookies are SameSite=Lax, so another site can neither send our cookies with a form post nor get an action to
// run. No CSRF token needed (docs/ARCHITECTURE.md, "Sign-in, sessions and roles").

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getDb } from "@/server/db";
import { PUSH_DEVICE_COOKIE, revokeBrowserPush, validDeviceProof } from "@/server/notifications/browser-push";

import { workerSignupValues } from "@/lib/auth/worker-signup";
import { VERIFICATION_COOLDOWN_SECONDS, verificationPath } from "@/lib/auth/verification";
import { SupabaseNotConfiguredError } from "@/lib/supabase/config";
import {
  logIn,
  logOut,
  readLogInForm,
  readSignUpForm,
  signUp,
  type AuthClient,
  type LogInResult,
  type SignUpResult,
} from "@/server/auth/account";
import { searchSignupAreas, type SignupAreaResult } from "@/server/auth/work-area";
import { prismaProfiles } from "@/server/auth/profiles";
import { rememberVerification, startVerification, verificationEmailUrl } from "@/server/auth/verification";
import { checkForClient, consumeForClient } from "@/server/rate-limit";
import { createSupabaseServerClient, rememberSessionChoice } from "@/server/supabase";

/** `useActionState` starts with null: nothing sent yet. */
export type SignUpState = SignUpResult | null;
export type LogInState = LogInResult | null;

const profiles = prismaProfiles();

/** Supabase Auth acting through this request's cookies, or null until sign-in is set up. */
async function authClient(options: { sessionOnly?: boolean } = {}): Promise<AuthClient | null> {
  try {
    return (await createSupabaseServerClient(options)).auth;
  } catch (error) {
    if (error instanceof SupabaseNotConfiguredError) return null;
    throw error;
  }
}

function notSetUp(formData: FormData) {
  console.error(new SupabaseNotConfiguredError().message);
  const email = formData.get("email");
  return { ok: false as const, error: "unavailable" as const, values: { email: typeof email === "string" ? email : "" } };
}

/**
 * Log in, slowed down for bots but never locking anyone out (DECISIONS.md, #340). Only wrong passwords count, and
 * they're counted per connection, not per email, so typing someone else's address can't stop them logging in.
 */
async function limitedLogIn(auth: AuthClient, formData: FormData): Promise<LogInResult> {
  const input = readLogInForm(formData);
  const blocked = await checkForClient("logInFailures");
  if (!blocked.allowed) return { ok: false, error: "try-later", values: { email: input.email.trim() }, retryAfter: blocked.retryAfter };
  const result = await logIn({ auth, profiles }, input);
  if (!result.ok && result.error === "wrong-credentials") await consumeForClient("logInFailures");
  return result;
}

/** The whole page tree re-renders on the next navigation, so the layout picks up the new role's colours. */
function refreshEverything() {
  revalidatePath("/", "layout");
}

/** Sign-up fields: name (or firstName/lastName), email, mobile phone, password, terms, role, next. */
export async function signUpAction(_previous: SignUpState, formData: FormData): Promise<SignUpState> {
  const auth = await authClient();
  if (!auth) {
    const unavailable = notSetUp(formData);
    const input = readSignUpForm(formData);
    return { ...unavailable, values: { email: input.email, firstName: input.firstName, lastName: input.lastName, phone: input.phone, role: input.role, terms: input.terms ? "on" : "", ...workerSignupValues(input.worker) } };
  }
  const input = readSignUpForm(formData);
  const limit = await consumeForClient("signUp");
  if (!limit.allowed) return { ok: false, error: "try-later", retryAfter: limit.retryAfter, values: { email: input.email, firstName: input.firstName, lastName: input.lastName, phone: input.phone, role: input.role, terms: input.terms ? "on" : "", ...workerSignupValues(input.worker) } };
  const result = await signUp({ auth, profiles, emailRedirectTo: verificationEmailUrl(input.next) }, input);
  if (result.ok) {
    const email = input.email.trim().toLowerCase();
    if (result.status === "signed-in") {
      const sent = await startVerification(email, input.next);
      if (!sent.ok && sent.error !== "try-later") await rememberVerification(email, 0);
    } else await rememberVerification(email, Date.now() + VERIFICATION_COOLDOWN_SECONDS * 1_000);
    refreshEverything();
    redirect(verificationPath(input.next));
  }
  return result;
}

/**
 * Log-in form fields: email, password, next (where to go back to), remember ("Keep me logged in": "on" keeps the
 * session for 400 days from the last visit, anything else ends it with the browser). Goes to `next`, or to the role's home.
 */
export async function logInAction(_previous: LogInState, formData: FormData): Promise<LogInState> {
  const sessionOnly = formData.get("remember") !== "on";
  const auth = await authClient({ sessionOnly });
  if (!auth) return notSetUp(formData);
  const result = await limitedLogIn(auth, formData);
  if (result.ok) {
    await rememberSessionChoice(sessionOnly);
    refreshEverything();
    redirect(result.redirectTo);
  }
  return result;
}

/**
 * Log in again without leaving the page: for the session-expired dialog (#108). Same fields and checks as
 * logInAction, but answers `{ ok: true }` instead of redirecting; the dialog then calls `router.refresh()` and
 * sends the form that failed again.
 */
export async function logInAgainAction(_previous: LogInState, formData: FormData): Promise<LogInState> {
  const auth = await authClient();
  if (!auth) return notSetUp(formData);
  const result = await limitedLogIn(auth, formData);
  if (result.ok) refreshEverything();
  return result;
}

/** Use as a form's action (a POST, so it's CSRF-safe; never a GET link). Ends the session and goes home. */
export async function logOutAction(): Promise<void> {
  try {
    const proof = (await cookies()).get(PUSH_DEVICE_COOKIE)?.value;
    if (validDeviceProof(proof)) await revokeBrowserPush(getDb(), proof);
  } catch { /* Logout still ends the session; display resolution refuses signed-out browsers. */ }
  const auth = await authClient();
  if (auth) await logOut(auth);
  await rememberSessionChoice(false);
  refreshEverything();
  redirect("/");
}

/** Suburb autocomplete is available before sign-in. It never changes an account or verification. */
export async function searchSignupAreasAction(query: string): Promise<SignupAreaResult> {
  // Too many searches: fall back to typing the suburb by hand, which always works.
  if (!(await consumeForClient("placeSearch")).allowed) return { mode: "manual", reason: "unavailable" };
  return searchSignupAreas(query);
}
