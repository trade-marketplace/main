import type { Metadata } from "next";
import { Suspense } from "react";

import { AccountSettings } from "@/components/account/AccountSettings";
import { ProfileLoading, ProfileSettings } from "@/components/account/ProfileSettings";
import { Banner } from "@/components/overlays/Banner";
import { TextLink } from "@/components/TextLink";
import { boardSettingsRoute } from "@/lib/job-board";
import { privateMetadata } from "@/lib/metadata";
import { loadProfilePage } from "@/server/account/profile-page";
import { requireRole } from "@/server/auth/guard";

export const metadata: Metadata = { ...privateMetadata, title: "Profile" };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ next?: unknown }> }) {
  // Signed out → log in and come back here; the office has no account pages (src/lib/auth/routes.ts).
  // A tradie sent here by the setup checklist (#132) keeps the way back to it.
  const destination = boardSettingsRoute("/profile", (await searchParams).next);
  const viewer = await requireRole(["CUSTOMER", "TRADIE"], { next: destination.href });
  return <AccountSettings role={viewer.role === "TRADIE" ? "TRADIE" : "CUSTOMER"} active="/profile">
    {viewer.role === "TRADIE" && destination.back && <TextLink href={destination.back}>Back to jobs</TextLink>}
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
