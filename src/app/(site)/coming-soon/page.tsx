import type { Metadata } from "next";

import { Waitlist } from "@/components/waitlist/Waitlist";
import { waitlistLocation } from "@/lib/waitlist";
import { loadCoverage } from "@/server/geo/coverage-settings";

import { joinWaitlist } from "./actions";

export const metadata: Metadata = { title: "Not in your area yet", robots: { index: false, follow: false } };

export default async function ComingSoon({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, coverage] = await Promise.all([searchParams, loadCoverage()]);
  return <Waitlist location={waitlistLocation(params)} coverage={coverage} submit={joinWaitlist} />;
}
