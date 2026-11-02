import type { Metadata } from "next";

import { CustomerSignup } from "@/components/auth/CustomerSignup";
import { safeNextPath } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "Create a customer account", description: "Set up your account to post jobs and keep track of the work.", alternates: { canonical: "/signup/customer" }, robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CustomerSignupPage({ searchParams }: { searchParams: SearchParams }) {
  const { next } = await searchParams;
  return <CustomerSignup next={typeof next === "string" ? safeNextPath(next) ?? undefined : undefined} />;
}
