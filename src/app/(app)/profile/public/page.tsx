import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountSettings } from "@/components/account/AccountSettings";
import { PublicEditorLoadError, PublicProfileEditor } from "@/components/account/PublicProfileEditor";
import { privateMetadata } from "@/lib/metadata";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { loadOwnProfilePreview } from "@/server/workers/public-profile";
import { savePublicBio } from "./actions";

export const metadata: Metadata = { ...privateMetadata, title: "Public profile" };

export default async function Page() {
  const viewer = await requireUser({ next: "/profile/public" });
  if (viewer.role !== "TRADIE") notFound();
  let snapshot;
  try {
    snapshot = await loadOwnProfilePreview(getDb(), viewer);
  } catch {
    return <AccountSettings role="TRADIE" active="/profile/public"><PublicEditorLoadError /></AccountSettings>;
  }
  if (!snapshot) notFound();
  return <AccountSettings role="TRADIE" active="/profile/public">
    <PublicProfileEditor key={viewer.userId} snapshot={snapshot} onSave={savePublicBio} />
  </AccountSettings>;
}
