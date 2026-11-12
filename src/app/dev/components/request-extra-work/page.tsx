import type { Metadata } from "next";
import { AppShellView } from "@/components/app/AppShellView";
import { EXTRA_WORK_STATES, type ExtraWorkState } from "@/lib/worker-extras";
import { guardDevPage } from "@/server/dev-pages";
import { ExtraWorkDemo } from "./ExtraWorkDemo";
import styles from "@/components/jobs/worker/extra-work.module.css";
export const metadata: Metadata = { title: "Request extra work (dev)", robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  guardDevPage();
  const { state } = await searchParams;
  const selected = EXTRA_WORK_STATES.includes(state as ExtraWorkState) ? state as ExtraWorkState : "closed";
  return <AppShellView viewer={{ role: "TRADIE", firstName: "Jack", lastName: "Wilson", email: "preview@example.test", emailVerified: true, counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: "/jobs/16000000-0000-4000-8000-000000000010", base: "/dev/components/request-extra-work" }}>
    {state === "gallery" ? <div className={styles.gallery}><h1>Extra work states</h1>{(["sent", "priced", "approved", "declined", "already-waiting", "loading", "empty"] as const).map(item => <article key={item}><h2>{item}</h2><ExtraWorkDemo state={item} embedded /></article>)}</div> : <ExtraWorkDemo key={selected} state={selected} />}
  </AppShellView>;
}
