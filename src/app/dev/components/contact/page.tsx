import type { Metadata } from "next";

import { SiteShellView } from "@/components/site/SiteShell";
import type { ContactState } from "@/lib/contact";
import { guardDevPage } from "@/server/dev-pages";

import { ContactDemo } from "./ContactDemo";

export const metadata: Metadata = { title: "Contact (dev)", robots: { index: false, follow: false } };

export default async function ContactPreview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams;
  const states: ContactState[] = ["empty", "sending", "sent", "error", "offline"];
  const state = states.find((value) => value === params.state) ?? "empty";
  return <SiteShellView viewer={null}><ContactDemo key={state} state={state} signedIn={params.signedin === "1"} /></SiteShellView>;
}
