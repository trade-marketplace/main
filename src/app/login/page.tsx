// Log in (#102, sitemap B01). Signed-in visitors never see it: the proxy sends them to their home.
import type { Metadata } from "next";
import Link from "next/link";

import { AuthLayout } from "@/components/auth/AuthLayout";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = { title: "Log in" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const { next } = await searchParams;
  // Only passed along: logInAction keeps it only if it's one of our own pages the person may open (afterLoginPath).
  const nextPath = typeof next === "string" && next.startsWith("/") ? next : undefined;
  const signUp = nextPath ? `/signup?next=${encodeURIComponent(nextPath)}` : "/signup";
  return (
    <AuthLayout
      title="Welcome back"
      aside={
        <>
          New here? <Link href={signUp}>Sign up</Link>
        </>
      }
    >
      <LoginForm next={nextPath} />
    </AuthLayout>
  );
}
