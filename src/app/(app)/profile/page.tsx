import type { Metadata } from "next";
import { Suspense } from "react";

import { AccountSettings } from "@/components/account/AccountSettings";
import { ProfileLoading, ProfileSettings } from "@/components/account/ProfileSettings";
import { Banner } from "@/components/overlays/Banner";
import { privateMetadata } from "@/lib/metadata";
import { loadProfilePage } from "@/server/account/profile-page";
import { requireRole } from "@/server/auth/guard";

export const metadata: Metadata = { ...privateMetadata, title: "Profile" };

export default async function ProfilePage() {
  // Signed out → log in and come back here; the office has no account pages (src/lib/auth/routes.ts).
  const viewer = await requireRole(["CUSTOMER", "TRADIE"], { next: "/profile" });
  return <AccountSettings role={viewer.role === "TRADIE" ? "TRADIE" : "CUSTOMER"} active="/profile">
    <Suspense fallback={<ProfileLoading />}><ProfileContent userId={viewer.userId} /></Suspense>
  </AccountSettings>;
}

async function ProfileContent({ userId }: { userId: string }) {
  const profile = await loadProfilePage(userId);
  if (!profile) return <>
    <h1>Profile</h1><Banner tone="alert">Couldn’t load your profile. <a href="/profile">Try again</a></Banner>
  </>;
  return <ProfileSettings {...profile} />;
}
