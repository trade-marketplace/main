// /dev/components/pay: the checkout form (#151, C10) in every state, with a mocked stand-in for Stripe's card fields, so it
// needs no keys (CI and the Screenshots bot have none). Compare with the "Checkout" mockup in docs/design/pages.html.
// `?state=` shows one state on its own. Dev only: the shared guard makes it a 404 in production.
import type { Metadata } from "next";

import { Icon } from "@/components/Icon";
import { CheckoutPage } from "@/components/payments/Checkout";
import { PayFormView, type PayState } from "@/components/payments/PayFormView";
import styles from "@/components/payments/payments.module.css";
import { guardDevPage } from "@/server/dev-pages";

export const metadata: Metadata = { title: "Pay form (dev)", robots: { index: false, follow: false } };

const STATES: readonly { state: PayState; title: string; message?: string }[] = [
  { state: "ready", title: "Ready" },
  { state: "loading", title: "Loading" },
  { state: "processing", title: "Processing (button spinner, form locked)" },
  { state: "failed", title: "Declined (stays on the form, Stripe’s words)", message: "Your card was declined." },
  { state: "succeeded", title: "Succeeded" },
  { state: "not-configured", title: "Payments not configured" },
];

// Example values only: real prices come from the server.
const SUMMARY = { title: "Sub wiring", jobNumber: 1005, suburb: "Windsor", amountCents: 37200, gstCents: 4852, photoUrl: "/images/examples/large/wires.jpg" };

function MockCardFields() {
  // Like the Payment Element's tabs: the methods Stripe offers on this device (Card, Apple Pay, Google Pay).
  return (
    <>
      <div className={styles.mockTabs} aria-hidden="true">
        {[["credit_card", "Card"], ["phone_iphone", "Apple Pay"], ["android", "Google Pay"]].map(([icon, label], i) => (
          <span key={label} className={styles.mockTab} data-on={i === 0 || undefined}>
            <Icon name={icon} decorative />
            {label}
          </span>
        ))}
      </div>
      <div className={styles.mockField}>
        <span className={styles.mockLabel}>Card number</span>
        <div className={styles.mockInput}>4242 4242 4242 4242</div>
      </div>
      <div className={styles.mockRow}>
        <div className={styles.mockField}>
          <span className={styles.mockLabel}>Expiry</span>
          <div className={styles.mockInput}>12 / 28</div>
        </div>
        <div className={styles.mockField}>
          <span className={styles.mockLabel}>CVC</span>
          <div className={styles.mockInput}>•••</div>
        </div>
      </div>
    </>
  );
}

export default async function PayPreview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const { state } = await searchParams;
  const shown = STATES.filter((entry) => !state || entry.state === state);
  return (
    <>
      {shown.map((entry) => (
        <section key={entry.state} id={entry.state} aria-label={entry.title}>
          <CheckoutPage summary={SUMMARY} testMode>
            <PayFormView state={entry.state} amountCents={SUMMARY.amountCents} message={entry.message}>
              <MockCardFields />
            </PayFormView>
          </CheckoutPage>
        </section>
      ))}
    </>
  );
}
