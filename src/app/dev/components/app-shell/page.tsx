// /dev/components/app-shell: the signed-in app shell (#84) with pretend people. Dev only: the shared guard makes it a
// 404 in production (and on every Vercel deployment), so the fake viewers never reach a real page. Names, emails
// and counts are examples.
//
//   ?viewer=customer|tradie|long|first-only   who is signed in (customer by default)
//   ?at=/dashboard                            the page the nav treats as current (clicking a nav link sets it)
//   ?counts=some|none|many                    unread messages and notifications
//   ?test=off                                 payments switched on (no test-mode banner)
//   ?menu=open                                the avatar menu open (for screenshots)
import type { Metadata } from "next";

import { guardDevPage } from "@/server/dev-pages";

import { COUNTS, type CountsKey, DEMO_VIEWERS, type DemoKey } from "./demo-data";
import { ShellDemo } from "./ShellDemo";

export const metadata: Metadata = {
  title: "App navigation (dev)",
  robots: { index: false, follow: false },
};

export const viewport = { viewportFit: "cover" as const };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function isKey<T extends string>(record: Record<T, unknown>, value: unknown): value is T {
  return typeof value === "string" && Object.hasOwn(record, value);
}

export default async function AppShellPreview({ searchParams }: { searchParams: SearchParams }) {
  guardDevPage();

  const params = await searchParams;
  const viewer: DemoKey = isKey(DEMO_VIEWERS, one(params.viewer)) ? (one(params.viewer) as DemoKey) : "customer";
  const counts: CountsKey = isKey(COUNTS, one(params.counts)) ? (one(params.counts) as CountsKey) : "some";
  const atParam = one(params.at);
  // Only paths inside the app: never a full URL.
  const at = atParam && atParam.startsWith("/") && !atParam.startsWith("//") ? atParam : DEMO_VIEWERS[viewer].home;

  return (
    <ShellDemo
      viewerKey={viewer}
      countsKey={counts}
      at={at}
      testMode={one(params.test) !== "off"}
      menuOpen={one(params.menu) === "open"}
    />
  );
}
