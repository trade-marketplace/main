import type { Metadata } from "next";
import { cookies } from "next/headers";

import { RecoveryFlow } from "@/components/auth/RecoveryFlow";
import { recoveryNext, recoverySeconds, type RecoveryState } from "@/lib/auth/recovery";
import { pendingRecovery, RECOVERY_AUTH_COOKIE, RECOVERY_COMPLETE_COOKIE, RECOVERY_SAVED_COOKIE, recoveryClient } from "@/server/auth/recovery";

export const metadata: Metadata = { title: "Reset password", robots: { index: false, follow: false } };

export default async function RecoveryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = recoveryNext(typeof params.next === "string" ? params.next : undefined) ?? undefined;
  const jar = await cookies();
  const pending = await pendingRecovery();
  let email = pending?.email ?? "";
  let state: RecoveryState = pending ? "sent" : "request";
  if (jar.get(RECOVERY_COMPLETE_COOKIE)?.value === "1") state = "complete";
  else if (jar.getAll().some((cookie) => cookie.name === RECOVERY_AUTH_COOKIE || cookie.name.startsWith(`${RECOVERY_AUTH_COOKIE}.`))) {
    if (jar.get(RECOVERY_SAVED_COOKIE)?.value === "1") state = "finish";
    else {
      try {
        const { data, error } = await (await recoveryClient({ readOnly: true })).auth.getUser();
        state = error ? error.status && error.status >= 500 ? "unavailable" : "expired" : data.user ? "reset" : "invalid";
        if (!error && data.user?.email) email = data.user.email;
      } catch {
        state = "unavailable";
      }
    }
  } else if (params.state === "reset") state = "invalid";
  if (params.state === "expired" || params.state === "invalid" || params.state === "unavailable") state = params.state;
  return <RecoveryFlow initialState={state} initialEmail={email} initialRetryAt={pending?.retryAt} initialSeconds={recoverySeconds(pending?.retryAt ?? 0)} next={next} />;
}
