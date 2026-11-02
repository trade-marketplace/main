// /pay/[id]/done (C11, #151): "Paid. You’re booked." Only shown once the money is really there: recorded by the webhook, or
// (if the webhook is a moment behind) confirmed with Stripe. Anything else goes back to the checkout (WEBAPP_SPEC C11).
import type { Metadata } from "next";
import { notFound, redirect, unstable_rethrow } from "next/navigation";

import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import styles from "@/components/payments/payments.module.css";
import { privateMetadata } from "@/lib/metadata";
import { payPath } from "@/lib/payments/results";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { paymentSucceededAtStripe } from "@/server/payments/payments";
import { getStripe } from "@/server/payments/stripe";

export const metadata: Metadata = { ...privateMetadata, title: "Paid" };

export default async function PayDonePage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const viewer = await requireRole(["CUSTOMER"], { next: payPath(paymentId) });

  let paid = false;
  let jobId: string | null = null;
  try {
    const payment = await getDb().payment.findFirst({
      where: { id: paymentId, job: { customerId: viewer.userId } },
      select: { status: true, jobId: true, providerPaymentId: true },
    });
    if (payment) {
      jobId = payment.jobId;
      paid = payment.status !== "PENDING" && payment.status !== "FAILED";
      if (!paid && payment.status === "PENDING") {
        try {
          paid = await paymentSucceededAtStripe(getStripe().paymentIntents, payment.providerPaymentId);
        } catch {
          paid = false;
        }
      }
    }
  } catch (error) {
    unstable_rethrow(error);
    console.error("Payment done: couldn't read the payment.", error);
  }
  if (!jobId) notFound();
  if (!paid) redirect(payPath(paymentId));

  return (
    <main className={styles.done}>
      <div className={styles.tick}>
        <Icon name="check" size="lg" decorative />
      </div>
      <h1 className={styles.doneTitle}>Paid. You’re booked.</h1>
      <p className={styles.doneText}>We’re finding someone local. We’ll message you as soon as a tradie takes it.</p>
      <div className={styles.doneActions}>
        <Button href={`/jobs/${jobId}`} width="auto">
          View my job
        </Button>
      </div>
    </main>
  );
}
