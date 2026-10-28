// /dev/components/login: the log-in page (#102) in each state it can come back in, so they can be seen and
// screenshotted without a Supabase project. `?state=` wrong (wrong email or password) | locked (too many tries) |
// unverified | invalid (empty fields) | unavailable. No state: the page as it first loads (the real one is /login).
// Pressing Log in here calls the real action. Dev only: the shared guard makes it a 404 in production.
import type { Metadata } from "next";

import { AuthLayout } from "@/components/auth/AuthLayout";
import { LoginForm } from "@/components/auth/LoginForm";
import type { LogInState } from "@/server/auth/actions";
import { guardDevPage } from "@/server/dev-pages";

export const metadata: Metadata = { title: "Log in (dev)", robots: { index: false, follow: false } };

const EMAIL = { email: "sarah@email.co.nz" };

const STATES: Record<string, LogInState> = {
  wrong: { ok: false, error: "wrong-credentials", values: EMAIL },
  locked: { ok: false, error: "try-later", values: EMAIL },
  unverified: { ok: false, error: "email-not-verified", values: EMAIL },
  invalid: {
    ok: false,
    error: "invalid",
    fieldErrors: { email: "Enter a valid email.", password: "Enter a password." },
    values: { email: "sarah@" },
  },
  unavailable: { ok: false, error: "unavailable", values: EMAIL },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPreview({ searchParams }: { searchParams: SearchParams }) {
  guardDevPage();
  const { state } = await searchParams;
  const initial = typeof state === "string" && Object.hasOwn(STATES, state) ? STATES[state] : null;
  return (
    <AuthLayout title="Welcome back">
      <LoginForm initialState={initial} key={String(state)} />
    </AuthLayout>
  );
}
