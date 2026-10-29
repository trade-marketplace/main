import type { Metadata } from "next";

import { verificationTiming } from "@/server/auth/verification";
import { guardDevPage } from "@/server/dev-pages";

import { VerifyEmailPreview } from "./VerifyEmailPreview";

export const metadata: Metadata = { title: "Verify email (dev)", robots: { index: false, follow: false } };

export default async function VerifyEmailPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const { state } = await searchParams;
  return <VerifyEmailPreview state={typeof state === "string" ? state : "waiting"} retryAt={verificationTiming().retryAt} />;
}
