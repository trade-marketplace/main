import type { Metadata } from "next";

import { OfficeShellView } from "@/components/office/OfficeShellView";
import { OFFICE_PAYMENT_STATES, type OfficePaymentsState, parseOfficePaymentsQuery } from "@/lib/office-payments";
import { guardDevPage } from "@/server/dev-pages";

import { PaymentsPreview } from "./Preview";

export const metadata: Metadata = { title: "Office payments (dev)", robots: { index: false, follow: false } };

// Every state of /admin/payments (#176): ?state=list | filtered | refund-dialog | empty | no-match | error | offline |
// loading. Filters, search and paging work on the example rows too (?status=refunded&q=1005&page=2).
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams;
  const candidate = typeof params.state === "string" ? params.state : "list";
  const state: OfficePaymentsState = OFFICE_PAYMENT_STATES.includes(candidate as OfficePaymentsState) ? (candidate as OfficePaymentsState) : "list";
  const query = parseOfficePaymentsQuery(params);
  return (
    <OfficeShellView
      viewer={{ role: "ADMIN", firstName: "Matt", lastName: "Larsen", email: "office@demo.test" }}
      counts={{ queues: 0, tradies: 0, support: 0 }}
      testMode
      preview={{ at: "/admin/payments", base: "/dev/components/office-payments" }}
    >
      <PaymentsPreview key={`${state}:${JSON.stringify(query)}`} state={state} query={query} />
    </OfficeShellView>
  );
}
