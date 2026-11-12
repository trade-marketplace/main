"use client";
import { useState } from "react";
import { TextLink } from "@/components/TextLink";
import { useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { SkeletonText } from "@/components/feedback/Skeleton";
import { Banner } from "@/components/overlays/Banner";
import { CancelJobDialog, type CancelAction } from "@/components/jobs/customer/CancelJobDialog";
import styles from "./demo.module.css";

export function CancelJobDemo({ state }: { state: string }) {
  const online = useOnlineStatus();
  const [attempts, setAttempts] = useState(0);
  const action: CancelAction = async () => {
    setAttempts(value => value + 1);
    if (state === "changed") return { status: "changed" };
    if (state === "error" && attempts === 0) return { status: "unavailable" };
    return { status: state === "free" ? "cancelled" : "requested" };
  };
  return <section aria-label="Cancellation preview" className={styles.page} data-mode="customer">
    <TextLink href="/dev/components/cancel-job?state=closed">My jobs</TextLink>
    <section className={styles.card}>
      <h1>Move a couch</h1>
      <p>TM-1001 · Windsor, Invercargill</p>
      {state === "loading" ? <div role="status" aria-label="Loading cancellation"><SkeletonText lines={3} /></div> : state === "empty" ? <Banner tone="info" title="No cancellation available." /> : <CancelJobDialog jobId="00000000-0000-4000-8000-000000000128" revision="preview" facts={{ canCancel: true, paid: !["free", "closed"].includes(state), workerFirstName: state === "paid-unclaimed" ? null : "Jack", onTheWay: state === "on-the-way" }} online={online && state !== "offline"} preview={state} action={action} />}
    </section>
  </section>;
}
