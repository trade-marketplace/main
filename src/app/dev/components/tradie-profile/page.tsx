import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NotFoundView } from "@/components/errors/NotFoundView";
import { ErrorState } from "@/components/feedback/ErrorState";
import { OfflineBanner } from "@/components/feedback/OfflineBanner";
import { SiteShellView } from "@/components/site/SiteShell";
import { ProfileSkeleton, TradieProfile } from "@/components/site/TradieProfile";
import { guardDevPage } from "@/server/dev-pages";
import type { PublicTradieProfile } from "@/server/workers/public-profile";

export const metadata: Metadata = { title: "Public tradie profile (dev)", robots: { index: false, follow: false } };

const reviews = [
  { rating: 5, month: "2026-11", comment: "On time, tidy, explained everything. Would use again.", customer: "Sarah", job: "Sub wiring" },
  { rating: 5, month: "2026-10", comment: "Sorted our heat pump circuit in an hour.", customer: "Tom", job: "Heat pump circuit" },
  { rating: 4, month: "2026-10", comment: "Good work, a day later than planned but kept me posted.", customer: "Aroha", job: "Downlights" },
];

async function retry() {
  "use server";
  guardDevPage();
  redirect("/dev/components/tradie-profile?state=full");
}

export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  guardDevPage();
  const { state } = await searchParams;
  const profile: PublicTradieProfile = {
    name: "Jack W.", avatarUrl: state === "photo-error" ? "/images/missing-avatar.jpg" : null,
    trades: state === "other-trade" ? ["OTHER"] : ["ELECTRICAL"], city: "Invercargill", jobs: 32, joined: 2024,
    rating: state === "no-reviews" ? null : 4.9, reviewCount: state === "no-reviews" ? 0 : 21,
    bio: state === "long-bio" ? "I work on electrical jobs across Invercargill, from fitting new lights to replacing switchboards. ".repeat(4).slice(0, 300) : null,
    reviews: state === "no-reviews" ? [] : reviews,
  };
  return <SiteShellView viewer={null}>
    {state === "paused" ? <NotFoundView /> : state === "error" ?
      <ErrorState size="page" title="Can’t load this profile" message="Check your connection and try again." onRetry={retry} /> :
      state === "loading" ? <ProfileSkeleton /> : <>
        {state === "offline" && <OfflineBanner online={false} sticky={false} />}
        <TradieProfile profile={profile} />
      </>}
  </SiteShellView>;
}
