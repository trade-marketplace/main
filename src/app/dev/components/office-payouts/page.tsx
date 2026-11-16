import type { Metadata } from "next";

import { OfficeShellView } from "@/components/office/OfficeShellView";
import styles from "@/components/office/payouts.module.css";
import { PAYOUT_STATES, type PayoutsState } from "@/lib/office/payouts";
import { guardDevPage } from "@/server/dev-pages";

import { PayoutsPreview } from "./Preview";

export const metadata: Metadata = { title: "Office payouts (dev)", robots: { index: false, follow: false } };

// Every state of /admin/payouts (#175): ?state=queued | blockers | nothing-queued | exported | mark-paid | paid |
// error | offline | loading, or gallery for error, loading and offline together.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams;
  const candidate = typeof params.state === "string" ? params.state : "queued";
  const state: PayoutsState = PAYOUT_STATES.includes(candidate as PayoutsState) ? (candidate as PayoutsState) : "queued";
  return (
    <OfficeShellView
      viewer={{ role: "ADMIN", firstName: "Matt", lastName: "Larsen", email: "office@demo.test" }}
      counts={{ queues: 0, tradies: 0, support: 0 }}
      testMode
      preview={{ at: "/admin/payouts", base: "/dev/components/office-payouts" }}
    >
      {candidate === "gallery" ? (
        <div className={styles.gallery}>
          {(["error", "loading", "offline"] as PayoutsState[]).map((item) => (
            <article key={item} aria-label={`${item} preview`}>
              <PayoutsPreview state={item} />
            </article>
          ))}
        </div>
      ) : (
        <PayoutsPreview key={state} state={state} />
      )}
    </OfficeShellView>
  );
}
