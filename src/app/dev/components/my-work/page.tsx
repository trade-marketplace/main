import type { Metadata } from "next";
import { AppShellView } from "@/components/app/AppShellView";
import { MY_WORK_STATES, parseMyWorkQuery } from "@/lib/my-work";
import { guardDevPage } from "@/server/dev-pages";
import { MyWorkDemo } from "./MyWorkDemo";
export const metadata: Metadata = { title: "My work (dev)", robots: { index: false, follow: false } };
export default async function Preview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams;
  const state = MY_WORK_STATES.find(item => item === params.state) ?? "full";
  const column = state === "queued-and-paid" ? "done" : state === "paused" ? "waiting-sign-off" : state === "waiting-ok" || state === "on-hold" ? "on-now" : undefined;
  const query = parseMyWorkQuery({ ...params, tab: params.tab ?? (state === "quotes" || state === "quotes-empty" ? "quotes" : undefined), column: params.column ?? column });
  return <AppShellView viewer={{ role: "TRADIE", firstName: "Jack", lastName: "Wilson", email: "worker@demo.test", emailVerified: true, counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: "/dashboard", base: "/dev/components/my-work" }}>
    <MyWorkDemo state={state} query={query} />
  </AppShellView>;
}
