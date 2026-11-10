import { headers } from "next/headers";
import { LandingPage } from "@/components/site/LandingPage";
import { StructuredData } from "@/components/site/StructuredData";
import { ipLocation } from "@/lib/landing";
import { businessStructuredData, faqStructuredData } from "@/lib/seo";
import { LANDING_FAQ } from "@/lib/site-faqs";
import { enabledServiceCategories } from "@/server/services";
import { loadCoverage } from "@/server/geo/coverage-settings";
import { LANDING_EXAMPLE_REVIEWS, LANDING_ILLUSTRATION_CENTS, landingReviews } from "@/server/landing";

/** The public homepage remains unchanged while C01 owns the signed-in customer's landing page. */
export async function PublicHome() {
  const [coverage, requestHeaders, reviews, enabledCategories] = await Promise.all([loadCoverage(), headers(), landingReviews(), enabledServiceCategories()]);
  return <><StructuredData data={businessStructuredData()} /><StructuredData data={faqStructuredData(LANDING_FAQ)} /><LandingPage data={{ enabledCategories, coverage, location: ipLocation(requestHeaders, coverage), reviews: reviews.length ? reviews : LANDING_EXAMPLE_REVIEWS, exampleReviews: reviews.length === 0, illustrationCents: LANDING_ILLUSTRATION_CENTS }} /></>;
}
