"use server";

// The sign-up, log-in and log-out server actions (#101). The log-in and sign-up pages (#102–#105) and the
// session-expired dialog (#108) call these; the logic lives in ./account.ts.
//
// CSRF: server actions only run on POST, Next.js refuses one whose Origin isn't this site's host, and the session
// cookies are SameSite=Lax, so another site can neither send our cookies with a form post nor get an action to
// run. No CSRF token needed (docs/ARCHITECTURE.md, "Sign-in, sessions and roles").

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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
import { prismaProfiles } from "@/server/auth/profiles";
import { createSupabaseServerClient } from "@/server/supabase";

/** `useActionState` starts with null: nothing sent yet. */
export type SignUpState = SignUpResult | null;
export type LogInState = LogInResult | null;

const profiles = prismaProfiles();

/** Supabase Auth acting through this request's cookies, or null until sign-in is set up. */
async function authClient(): Promise<AuthClient | null> {
  try {
    return (await createSupabaseServerClient()).auth;
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

/** The whole page tree re-renders on the next navigation, so the layout picks up the new role's colours. */
function refreshEverything() {
  revalidatePath("/", "layout");
}

/** Sign-up form fields: email, password, firstName, lastName, role (CUSTOMER | TRADIE), next. */
export async function signUpAction(_previous: SignUpState, formData: FormData): Promise<SignUpState> {
  const auth = await authClient();
  if (!auth) return notSetUp(formData);
  const result = await signUp({ auth, profiles }, readSignUpForm(formData));
  if (result.ok && result.status === "signed-in") {
    refreshEverything();
    redirect(result.redirectTo);
  }
  return result;
}

/** Log-in form fields: email, password, next (where to go back to). Goes there, or to the role's home. */
export async function logInAction(_previous: LogInState, formData: FormData): Promise<LogInState> {
  const auth = await authClient();
  if (!auth) return notSetUp(formData);
  const result = await logIn({ auth, profiles }, readLogInForm(formData));
  if (result.ok) {
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
  const result = await logIn({ auth, profiles }, readLogInForm(formData));
  if (result.ok) refreshEverything();
  return result;
}

/** Use as a form's action (a POST, so it's CSRF-safe; never a GET link). Ends the session and goes home. */
export async function logOutAction(): Promise<void> {
  const auth = await authClient();
  if (auth) await logOut(auth);
  refreshEverything();
  redirect("/");
}
