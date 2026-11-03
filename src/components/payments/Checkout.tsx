// The focused checkout page (C10, docs/design/pages.html): slim nav, test-mode banner, "Pay & book", the card form on
// the left and the order summary on the right (sticky on a computer, above the form's end on a phone).
import type { ReactNode } from "react";

import { Icon } from "@/components/Icon";
import { TextLink } from "@/components/TextLink";
import { Banner } from "@/components/overlays/Banner";
import { Wordmark } from "@/components/Wordmark";
import { money } from "@/lib/office-job";
import { PAY_ACTION_ID } from "@/lib/payments/results";

import styles from "./payments.module.css";

export type CheckoutSummary = {
  title: string;
  jobNumber: number;
  suburb: string;
  amountCents: number;
  gstCents: number | null;
  /** For the "Back to job" link. */
  jobId?: string;
  /** The job's cover photo (a short-lived signed link), if it has one. */
  photoUrl?: string | null;
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
          {summary.jobId && (
            <TextLink href={`/jobs/${summary.jobId}`} className={styles.back}>
              <Icon name="arrow_back" size="sm" decorative />
              Back to job
            </TextLink>
          )}
          <h1 className={styles.title}>Pay &amp; book</h1>
          <div className={styles.card}>{children}</div>
        </div>
        <aside className={`${styles.card} ${styles.summary}`} aria-label="Order summary">
          <div className={styles.job}>
            {summary.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed Storage link, not a static asset
              <img className={styles.thumb} src={summary.photoUrl} alt="" width={64} height={64} />
            ) : (
              <span className={styles.thumb} aria-hidden="true"><Icon name="handyman" decorative /></span>
            )}
            <div className={styles.jobText}>
              <p className={styles.jobName}>{summary.title}</p>
              <p className={styles.jobMeta}>
                TM-{summary.jobNumber} · {summary.suburb}
              </p>
            </div>
          </div>
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
          <ul className={styles.promises}>
            <li><Icon name="check_circle" size="sm" decorative fill />Fixed price. It won’t go up.</li>
            <li><Icon name="check_circle" size="sm" decorative fill />Extra work only if you say yes.</li>
          </ul>
          {/* The Pay button and receipt line land here from the pay form (PayFormView), as in C10. */}
          <div id={PAY_ACTION_ID} className={styles.action} />
        </aside>
      </main>
    </div>
  );
}
