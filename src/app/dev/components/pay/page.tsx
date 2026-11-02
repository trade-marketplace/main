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
const SUMMARY = { jobId: "preview", title: "Sub wiring", jobNumber: 1005, suburb: "Windsor", amountCents: 37200, gstCents: 4852, photoUrl: "/images/examples/large/wires.jpg" };

function MockCardFields() {
  // Stands in for Stripe's Payment Element as it looks with our appearance: labelled fields, card brands, country.
  return (
    <>
      <div className={styles.mockField}>
        <span className={styles.mockLabel}>Card number</span>
        <div className={styles.mockInput}>
          <span className={styles.mockGrow}>1234 1234 1234 1234</span>
          <span className={styles.brands} aria-hidden="true"><span>VISA</span><span>MC</span><span>AMEX</span></span>
        </div>
      </div>
      <div className={styles.mockRow}>
        <div className={styles.mockField}>
          <span className={styles.mockLabel}>Expiration date</span>
          <div className={styles.mockInput}>MM / YY</div>
        </div>
        <div className={styles.mockField}>
          <span className={styles.mockLabel}>Security code</span>
          <div className={styles.mockInput}>CVC</div>
        </div>
      </div>
      <div className={styles.mockField}>
        <span className={styles.mockLabel}>Country</span>
        <div className={styles.mockInput}>New Zealand</div>
      </div>
    </>
  );
}

function MockWallets() {
  return (
    <>
      <span className={styles.mockWallet}><Icon name="phone_iphone" size="sm" decorative /> Pay</span>
      <span className={styles.mockWallet}>G Pay</span>
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
            <PayFormView state={entry.state} amountCents={SUMMARY.amountCents} message={entry.message} express={<MockWallets />} expressReady>
              <MockCardFields />
            </PayFormView>
          </CheckoutPage>
        </section>
      ))}
    </>
  );
}
