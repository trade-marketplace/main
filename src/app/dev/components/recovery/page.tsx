import type { Metadata } from "next";

import { guardDevPage } from "@/server/dev-pages";
import { recoveryRetryAt } from "@/server/auth/recovery";

import { RecoveryPreview } from "./RecoveryPreview";
import styles from "./gallery.module.css";

export const metadata: Metadata = { title: "Reset password (dev)", robots: { index: false, follow: false } };

export default async function RecoveryPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const { state } = await searchParams;
  if (state === "feedback") return <main id="main" aria-label="Recovery feedback states" className={styles.gallery}>
    <h1>Recovery feedback states</h1>
    {["loading", "reset-loading", "offline", "reset-offline", "send-error", "save-error"].map((name) => <section key={name}>
      <h2>{name}</h2>
      <RecoveryPreview state={name} retryAt={recoveryRetryAt()} embedded />
    </section>)}
  </main>;
  return <RecoveryPreview state={typeof state === "string" ? state : "request"} retryAt={recoveryRetryAt()} />;
}
