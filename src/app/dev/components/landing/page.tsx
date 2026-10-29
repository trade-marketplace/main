import type { Metadata } from "next";

import { SiteShellView } from "@/components/site/SiteShell";
import { INVERCARGILL_COVERAGE } from "@/lib/geo/coverage";
import { guardDevPage } from "@/server/dev-pages";
import { LANDING_ILLUSTRATION_CENTS, LANDING_EXAMPLE_REVIEWS } from "@/server/landing";

import { LandingDemo } from "./LandingDemo";

export const metadata: Metadata = { title: "Homepage (dev)", robots: { index: false, follow: false } };
const REVIEWS = LANDING_EXAMPLE_REVIEWS;

export default async function LandingPreview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams;
  const state = typeof params.state === "string" ? params.state : "signed-out";
  const data = { coverage: INVERCARGILL_COVERAGE, illustrationCents: LANDING_ILLUSTRATION_CENTS, reviews: state === "no-reviews" ? [] : REVIEWS, exampleReviews: state !== "reviews", location: state === "outside" ? { label: "Wellington", point: { lat: -41.2866, lng: 174.7756 } } : { label: "Invercargill", point: null } };
  return <SiteShellView viewer={state === "signed-in" ? { firstName: "Sarah", role: "CUSTOMER" } : null}><LandingDemo key={state} data={data} state={state} /></SiteShellView>;
}
