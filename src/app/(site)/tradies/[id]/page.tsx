import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TradieProfile } from "@/components/site/TradieProfile";
import { getDb } from "@/server/db";
import { loadPublicProfile } from "@/server/workers/public-profile";

export const metadata: Metadata = { title: "Public tradie profile", robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const profile = process.env.DATABASE_URL?.trim() ? await loadPublicProfile(getDb(), (await params).id) : null;
  if (!profile) notFound();
  return <TradieProfile profile={profile} />;
}
