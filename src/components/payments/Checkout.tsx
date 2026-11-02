// The focused checkout page (C10, docs/design/pages.html): slim nav, test-mode banner, "Pay & book", the card form on
// the left and the order summary on the right (sticky on a computer, above the form's end on a phone).
import type { ReactNode } from "react";

import { Icon } from "@/components/Icon";
import { Banner } from "@/components/overlays/Banner";
import { Wordmark } from "@/components/Wordmark";
import { money } from "@/lib/office-job";

import styles from "./payments.module.css";

export type CheckoutSummary = {
  title: string;
  jobNumber: number;
  suburb: string;
  amountCents: number;
  gstCents: number | null;
};

export function CheckoutPage({ summary, testMode, children }: { summary: CheckoutSummary; testMode: boolean; children: ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.nav}>
        <Wordmark className={styles.logo} />
        <span className={styles.secure}>
          <Icon name="lock" size="sm" decorative fill />
          Secure checkout
        </span>
      </header>
      <main className={styles.wrap}>
        <div className={styles.main}>
          {testMode && (
            <Banner tone="test" title="Test mode.">
              No real money moves. Use card 4242 4242 4242 4242.
            </Banner>
          )}
          <h1 className={styles.title}>Pay &amp; book</h1>
          <div className={styles.card}>{children}</div>
        </div>
        <aside className={`${styles.card} ${styles.summary}`} aria-label="Order summary">
          <p className={styles.jobName}>{summary.title}</p>
          <p className={styles.jobMeta}>
            TM-{summary.jobNumber} · {summary.suburb}
          </p>
          <ul className={styles.lines}>
            {summary.gstCents !== null && (
              <>
                <li>
                  <span>Fixed price</span>
                  <span>{money(summary.amountCents - summary.gstCents)}</span>
                </li>
                <li>
                  <span>GST (15%)</span>
                  <span>{money(summary.gstCents)}</span>
                </li>
              </>
            )}
            <li className={styles.total}>
              <span>Total</span>
              <span className={styles.totalPrice}>{money(summary.amountCents)}</span>
            </li>
          </ul>
        </aside>
      </main>
    </div>
  );
}
