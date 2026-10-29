import type { Metadata } from "next";

import { AccountSettings } from "@/components/account/AccountSettings";
import { SecuritySettings } from "@/components/account/SecuritySettings";
import { Banner } from "@/components/overlays/Banner";
import { privateMetadata } from "@/lib/metadata";
import { requireRole } from "@/server/auth/guard";
import { readSecurityUser } from "@/server/auth/security";
import { securityDeps } from "@/server/auth/security-deps";

export const metadata: Metadata = { ...privateMetadata, title: "Security" };

export default async function SecurityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireRole(["CUSTOMER", "TRADIE"], { next: "/profile/security" });
  let user = null;
  try { user = await readSecurityUser(await securityDeps(), viewer.userId); } catch { /* Retry stays on this route. */ }
  const params = await searchParams;
  return <AccountSettings role={viewer.role === "TRADIE" ? "TRADIE" : "CUSTOMER"}>
    {user?.email ? <SecuritySettings email={user.email} pendingEmail={user.new_email} confirmError={params.confirm === "invalid"} /> : <>
      <h1>Security</h1><Banner tone="alert">Couldn’t load your security settings. <a href="/profile/security">Try again</a></Banner>
    </>}
  </AccountSettings>;
}
