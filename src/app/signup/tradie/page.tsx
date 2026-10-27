import type { Metadata } from "next";

import { SignupDetails } from "@/components/auth/CustomerSignup";
import { safeNextPath } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "Join as a tradie", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export default async function TradieSignupPage({ searchParams }: { searchParams: SearchParams }) {
  const { next, step } = await searchParams;
  return <SignupDetails role="tradie" next={typeof next === "string" ? safeNextPath(next) ?? undefined : undefined} initialTradeStep={step === "trade"} />;
}
