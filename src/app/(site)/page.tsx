import type { Metadata } from "next";
import { headers } from "next/headers";

import { LandingPage } from "@/components/site/LandingPage";
import { StructuredData } from "@/components/site/StructuredData";
import { ipLocation } from "@/lib/landing";
import { businessStructuredData, faqStructuredData } from "@/lib/seo";
import { LANDING_FAQ } from "@/lib/site-faqs";
import { loadCoverage } from "@/server/geo/coverage-settings";
import { LANDING_EXAMPLE_REVIEWS, LANDING_ILLUSTRATION_CENTS, landingReviews } from "@/server/landing";

export const metadata: Metadata = { title: { absolute: "Trade Marketplace — Sorted in a flash." }, description: "Post any job free. Accept the price. Someone local sorts it. Trades, moving, cleaning, gardening and more.", alternates: { canonical: "/" } };

export default async function Home() {
  const [coverage, requestHeaders, reviews] = await Promise.all([loadCoverage(), headers(), landingReviews()]);
  return <><StructuredData data={businessStructuredData()} /><StructuredData data={faqStructuredData(LANDING_FAQ)} /><LandingPage data={{ coverage, location: ipLocation(requestHeaders, coverage), reviews: reviews.length ? reviews : LANDING_EXAMPLE_REVIEWS, exampleReviews: reviews.length === 0, illustrationCents: LANDING_ILLUSTRATION_CENTS }} /></>;
}
