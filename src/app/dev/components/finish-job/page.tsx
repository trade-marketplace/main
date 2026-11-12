import type { Metadata } from "next";
import { AppShellView } from "@/components/app/AppShellView";
import { FINISH_STATES, type FinishState } from "@/lib/finish-job";
import { guardDevPage } from "@/server/dev-pages";
import { FinishDemo } from "./FinishDemo";
import styles from "./preview.module.css";
export const metadata: Metadata = { title: "Finish job (dev)", robots: { index: false, follow: false } };
const recovery: FinishState[] = ["waiting-extra", "not-configured", "read-only", "error", "offline", "loading", "load-error"];
export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  guardDevPage();
  const { state } = await searchParams;
  const selected = state === "sent-back" ? "sent-back" : FINISH_STATES.includes(state as FinishState) ? state as FinishState : "electrical";
  return <AppShellView viewer={{ role: "TRADIE", firstName: "Jack", lastName: "Wilson", email: "preview@example.test", emailVerified: true, counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: "/jobs/15000000-0000-4000-8000-000000000001/complete", base: "/dev/components/finish-job" }}>
    {state === "recovery-gallery" ? <div className={styles.gallery}><h1>Finish job states</h1>{recovery.map(item => <article key={item} aria-labelledby={`finish-${item}`}><h2 id={`finish-${item}`}>{item}</h2><FinishDemo state={item} embedded /></article>)}</div> : <FinishDemo key={selected} state={selected} />}
  </AppShellView>;
}
