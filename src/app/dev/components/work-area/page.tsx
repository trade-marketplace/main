import type { Metadata } from "next";
import { AccountSettings } from "@/components/account/AccountSettings";
import { AppShellView } from "@/components/app/AppShellView";
import { WORK_AREA_STATES } from "@/lib/account/work-area";
import { guardDevPage } from "@/server/dev-pages";
import styles from "./preview.module.css";
import { WorkAreaDemo } from "./WorkAreaDemo";

export const metadata: Metadata = { title: "Work area (dev)", robots: { index: false, follow: false } };
export default async function Preview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams;
  const state = WORK_AREA_STATES.find(item => item === params.state) ?? "ready";
  return <AppShellView viewer={{ role: "TRADIE", firstName: "Jack", lastName: "Wilson", email: "worker@demo.test", emailVerified: true, counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: "/profile/area", base: "/dev/components/work-area" }}>
    <AccountSettings role="TRADIE" active="/profile/area">{params.state === "gallery" ? <div className={styles.gallery}><h1>Work area states</h1>{(["offline", "loading", "load-error"] as const).map(item => <section key={item} aria-labelledby={`work-area-state-${item}`}><h2 id={`work-area-state-${item}`}>{item}</h2><WorkAreaDemo state={item} network={false} /></section>)}</div> : <WorkAreaDemo state={state} network={params.transport === "network"} />}</AccountSettings>
  </AppShellView>;
}
