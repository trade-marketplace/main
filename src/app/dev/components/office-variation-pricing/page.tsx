import type { Metadata } from "next";
import { OfficeShellView } from "@/components/office/OfficeShellView";
import { guardDevPage } from "@/server/dev-pages";
import { VARIATION_STATES, variationExample, type VariationState } from "./preview-data";
import { PreviewClient } from "./PreviewClient";
export const metadata: Metadata = { title: "Extra-work pricing (dev)", robots: { index: false, follow: false } };
export default async function Preview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams, candidate = typeof params.state === "string" ? params.state : "ready";
  const state: VariationState = VARIATION_STATES.includes(candidate as VariationState) ? candidate as VariationState : "ready";
  return <OfficeShellView viewer={{ role: "ADMIN", firstName: "Matt", lastName: "Larsen", email: "office@demo.test" }} counts={{ queues: state === "sent" ? 0 : 1, tradies: 0, support: 0 }} testMode preview={{ at: "/admin", base: "/dev/components/office-variation-pricing" }}>
    <PreviewClient key={state} data={variationExample(state).data} state={state} />
  </OfficeShellView>;
}
