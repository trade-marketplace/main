"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import type { PaymentCompletion } from "@/lib/payments/results";
import styles from "./payments.module.css";

const COPY = {
  booked: { title: "Paid. You’re booked.", body: "We’re finding someone local. We’ll message you as soon as a tradie takes it.", icon: "check" },
  "variation-approved": { title: "Extra work approved.", body: "We’ve told your tradie to go ahead with the extra work.", icon: "check" },
  "variation-checking": { title: "Paid.", body: "Checking extra work approval. The tradie hasn’t been told to start it.", icon: "pending" },
  "variation-review": { title: "Payment needs review", body: "The office is reviewing this payment. The extra work hasn’t been approved.", icon: "support_agent" },
} as const;

export function PaymentDone({ completion }: { completion: PaymentCompletion }) {
  const router = useRouter();
  useEffect(() => {
    if (completion.outcome !== "variation-checking") return;
    let attempts = 0;
    const timer = setInterval(() => { router.refresh(); if (++attempts >= 10) clearInterval(timer); }, 3000);
    return () => clearInterval(timer);
  }, [completion.outcome, router]);
  const copy = COPY[completion.outcome];
  return <main className={styles.done} data-outcome={completion.outcome}>
    <div className={styles.tick} data-outcome={completion.outcome}><Icon name={copy.icon} size="lg" decorative /></div>
    <h1 className={styles.doneTitle}>{copy.title}</h1>
    <p className={styles.doneText}>{copy.body}</p>
    <div className={styles.doneActions}>
      <Button href={`/jobs/${completion.jobId}`} width="auto">View my job</Button>
      {completion.outcome === "variation-checking" && <Button variant="secondary" width="auto" onClick={() => router.refresh()}>Check again</Button>}
    </div>
  </main>;
}
