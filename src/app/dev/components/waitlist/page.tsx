import type { Metadata } from "next";

import { SiteShellView } from "@/components/site/SiteShell";
import { INVERCARGILL_COVERAGE } from "@/lib/geo/coverage";
import type { WaitlistState } from "@/lib/waitlist";
import { guardDevPage } from "@/server/dev-pages";

import { WaitlistDemo } from "./WaitlistDemo";

export const metadata: Metadata = { title: "Waitlist (dev)", robots: { index: false, follow: false } };

export default async function WaitlistPreview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams;
  const states: WaitlistState[] = ["empty", "loading", "joined", "already-on-list", "error", "offline"];
  const state = states.find((value) => value === params.state) ?? "empty";
  return <SiteShellView viewer={null}><WaitlistDemo key={state} state={state} coverage={INVERCARGILL_COVERAGE} /></SiteShellView>;
}
