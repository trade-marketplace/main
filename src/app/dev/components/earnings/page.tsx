// /dev/components/earnings: the tradie's Earnings page (#165, D12) in every state, with pretend payouts and no
// database. Flags: ?state=default|empty|loading|error|long|no-paid · ?payroll=next|2026-10-30 (the detail drawer
// open) · ?details=missing (payroll has no bank / IRD details yet).
// Development only: in a production build this page is a 404. Names, hours and amounts are examples.
import type { Metadata, Viewport } from "next";

import { AppShellView } from "@/components/app/AppShellView";
import { Earnings } from "@/components/earnings/Earnings";
import { parseEarningsQuery } from "@/lib/earnings";
import { guardDevPage } from "@/server/dev-pages";

import { isPreviewState, PREVIEW_BASE, previewView } from "./preview-data";

export const metadata: Metadata = { title: "Earnings (dev)", robots: { index: false, follow: false } };
export const viewport: Viewport = { viewportFit: "cover" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function EarningsPreview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams;
  const stateParam = one(params.state);
  const state = isPreviewState(stateParam) ? stateParam : "default";
  const { payroll } = parseEarningsQuery(params);
  const missing = one(params.details) === "missing";
  return (
    <AppShellView
      viewer={{ role: "TRADIE", firstName: "Jack", lastName: "Wilson", email: "tradie@example.test", emailVerified: true, counts: { messages: 0, notifications: 0 } }}
      testMode
      preview={{ at: "/earnings", base: PREVIEW_BASE }}
    >
      <Earnings
        key={state}
        view={previewView(state)}
        loading={state === "loading"}
        payroll={payroll}
        flag={state}
        basePath={PREVIEW_BASE}
        statementHref="#statement"
        payrollDetails={missing ? { complete: false, missing: ["bank", "ird"] } : { complete: true, missing: [] }}
      />
    </AppShellView>
  );
}
