// /dev/components/session-expired: the “You’ve been logged out” dialog (B07, #108) over a pretend page with a
// draft, so the whole round trip can be tried: send → logged out → log in again → the draft is sent. Dev only: the
// shared guard makes it a 404 in production (and on every Vercel deployment). Names and emails are examples.
//
//   ?open=notice|form       the dialog open on load (for screenshots), at its first or second step
//   ?state=wrong|locked|unverified|invalid|unavailable   with that answer showing (implies open=form)
//   ?email=off              the email isn't known, so it can be typed
import type { Metadata } from "next";

import { guardDevPage } from "@/server/dev-pages";

import { PREVIEW_STATES, type PreviewOpen, type PreviewState } from "./demo-data";
import { SessionExpiredDemo } from "./SessionExpiredDemo";

export const metadata: Metadata = {
  title: "Session expired (dev)",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function SessionExpiredPreview({ searchParams }: { searchParams: SearchParams }) {
  guardDevPage();

  const params = await searchParams;
  const stateParam = one(params.state);
  const state = stateParam && Object.hasOwn(PREVIEW_STATES, stateParam) ? (stateParam as PreviewState) : undefined;
  const openParam = one(params.open);
  const open: PreviewOpen | undefined = state ? "form" : openParam === "notice" || openParam === "form" ? openParam : undefined;

  return <SessionExpiredDemo open={open} state={state} knownEmail={one(params.email) !== "off"} />;
}
