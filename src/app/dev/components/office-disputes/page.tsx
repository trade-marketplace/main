// /dev/components/office-disputes: cancellations and disputes (#172, F06) in every state, with a pretend server.
// ?state=list|empty|cancellation|problem|partial-refund|decided|refund-failed|error|offline|loading
// Development only: in a production build this page is a 404. Names, prices and times are examples.
import type { Metadata } from "next";

import { OfficeShellView } from "@/components/office/OfficeShellView";
import { DISPUTE_PREVIEW_STATES, type DisputePreviewState } from "@/lib/office-disputes";
import { guardDevPage } from "@/server/dev-pages";

import { Preview } from "./Preview";

export const metadata: Metadata = { title: "Office disputes (dev)", robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  guardDevPage();
  const query = await searchParams;
  const state = DISPUTE_PREVIEW_STATES.includes(query.state as DisputePreviewState) ? (query.state as DisputePreviewState) : "list";
  return (
    <OfficeShellView
      viewer={{ role: "ADMIN", firstName: "Matt", lastName: "Larsen", email: "office@demo.test" }}
      counts={{ queues: 3, tradies: 0, support: 0 }}
      testMode
      preview={{ at: "/admin/disputes", base: "/dev/components/office-disputes" }}
    >
      <Preview state={state} />
    </OfficeShellView>
  );
}
