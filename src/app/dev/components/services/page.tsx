import type { Metadata } from "next";

import { SiteShellView } from "@/components/site/SiteShell";
import { isCategory } from "@/lib/cards";
import { INVERCARGILL_COVERAGE } from "@/lib/geo/coverage";
import { SERVICE_PREVIEW_STATES } from "@/lib/services";
import { guardDevPage } from "@/server/dev-pages";
import { SERVICE_CONTENT } from "@/server/services";

import { ServiceDemo } from "./ServiceDemo";

export const metadata: Metadata = { title: "Service pages (dev)", robots: { index: false, follow: false } };
export default async function ServicePreview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams;
  const state = SERVICE_PREVIEW_STATES.find((value) => value === params.state) ?? "live";
  const category = isCategory(params.trade) ? params.trade : "electrical";
  const coming = ["coming-soon", "sending", "joined", "already-on-list", "waitlist-error", "offline"].includes(state);
  const data = { ...SERVICE_CONTENT[category], live: !coming, jobs: state === "empty" ? [] : SERVICE_CONTENT[category].jobs, coverage: INVERCARGILL_COVERAGE,
    // Only local demonstration records; deployed pages read public reviews for this trade from the database.
    reviews: state === "reviews" ? [{ id: "demo-review", name: "Demo customer", rating: 5, comment: "Service review preview." }] : [], reviewsUnavailable: state === "reviews-error" };
  return <SiteShellView viewer={null}><ServiceDemo key={`${category}-${state}`} data={data} state={state} /></SiteShellView>;
}
