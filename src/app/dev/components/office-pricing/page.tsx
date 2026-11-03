import type { Metadata } from "next";
import { OfficeShellView } from "@/components/office/OfficeShellView";
import { guardDevPage } from "@/server/dev-pages";
import { PRICE_STATES, pricingExample, type PriceState } from "./preview-data";
import { PreviewClient } from "./PreviewClient";
export const metadata: Metadata = { title: "Office pricing (dev)", robots: { index: false, follow: false } };
export default async function Preview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams, candidate = typeof params.state === "string" ? params.state : "ready", state: PriceState = PRICE_STATES.includes(candidate as PriceState) ? candidate as PriceState : "ready";
  const { data, fieldErrors } = pricingExample(state, params.invalid === "1");
  return <OfficeShellView viewer={{ role: "ADMIN", firstName: "Matt", lastName: "Larsen", email: "office@demo.test" }} counts={{ queues: state === "sent" ? 0 : 1, tradies: 0, support: 0 }} testMode preview={{ at: "/admin", base: "/dev/components/office-pricing" }}>
    <PreviewClient key={`${state}:${params.invalid ?? ""}`} data={data} state={state} fieldErrors={fieldErrors} />
  </OfficeShellView>;
}
