// Sign up, step one: customer or tradie (#103, sitemap B02). Signed-in visitors never see it: the proxy sends them
// to their home. `?as=tradie` starts on the tradie card (links from For tradies).
import type { Metadata } from "next";

import { SignupChoice } from "@/components/auth/SignupChoice";
import { privateMetadata } from "@/lib/metadata";

export const metadata: Metadata = { ...privateMetadata, title: "Create account", description: "Create an account to post a job or find work near you.", alternates: { canonical: "/signup" } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SignupPage({ searchParams }: { searchParams: SearchParams }) {
  const { next, as } = await searchParams;
  // Only passed along: the details step and log-in check it again (afterLoginPath).
  const nextPath = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : undefined;
  return <SignupChoice next={nextPath} initialRole={as === "tradie" ? "tradie" : "customer"} />;
}
