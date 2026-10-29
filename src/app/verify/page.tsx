import type { Metadata } from "next";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";

import { VerifyEmail } from "@/components/auth/VerifyEmail";
import { safeNextPath } from "@/lib/auth/routes";
import { verificationDestination, type VerificationState } from "@/lib/auth/verification";
import { getViewer } from "@/server/auth/viewer";
import { pendingVerification, verificationTiming, VERIFICATION_COMPLETE_COOKIE } from "@/server/auth/verification";

export const metadata: Metadata = { title: "Verify email", robots: { index: false, follow: false } };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : undefined) ?? undefined;
  let viewer = null;
  let unavailable = false;
  try {
    viewer = await getViewer();
  } catch (error) {
    unstable_rethrow(error);
    unavailable = true;
  }
  const pending = await pendingVerification();
  const complete = (await cookies()).get(VERIFICATION_COMPLETE_COOKIE)?.value === "1";
  const verified = viewer ? viewer.emailVerified : complete;
  const email = viewer?.email ?? pending?.email ?? "";
  const retryAt = pending?.email === email ? pending.retryAt : 0;
  const timing = verificationTiming(retryAt);
  let state: VerificationState = verified ? "verified" : unavailable ? "unavailable" : retryAt ? "waiting" : "ready";
  if (!verified && (params.state === "expired" || params.state === "invalid" || params.state === "unavailable")) state = params.state;
  return <VerifyEmail initialState={state} initialEmail={email} initialRetryAt={retryAt} initialSeconds={timing.seconds}
    next={next} signedIn={Boolean(viewer)} continueTo={verificationDestination(viewer?.role, next)} />;
}
