import type { Metadata } from "next";
import { AppShellView } from "@/components/app/AppShellView";
import { WORKSPACE_STATES, type WorkspaceState } from "@/lib/worker-workspace";
import { guardDevPage } from "@/server/dev-pages";
import { WorkspaceDemo } from "./WorkspaceDemo";
import styles from "./preview.module.css";
export const metadata: Metadata = { title: "Job workspace (dev)", robots: { index: false, follow: false } };
const recovery: WorkspaceState[] = ["completed", "on-hold", "error", "offline", "loading", "load-error"];
export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  guardDevPage();
  const { state } = await searchParams;
  const selected = WORKSPACE_STATES.includes(state as WorkspaceState) ? state as WorkspaceState : "booked";
  return <AppShellView viewer={{ role: "TRADIE", firstName: "Jack", lastName: "Wilson", email: "preview@example.test", emailVerified: true, counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: "/jobs/14900000-0000-4000-8000-000000000001", base: "/dev/components/worker-workspace" }}>
    {state === "recovery-gallery" ? <div className={styles.gallery}><h1>Workspace states</h1>{recovery.map(item => <article key={item} aria-labelledby={`workspace-${item}`}><h2 id={`workspace-${item}`}>{item}</h2><WorkspaceDemo state={item} embedded /></article>)}</div> : <WorkspaceDemo key={selected} state={selected} />}
  </AppShellView>;
}
