import type { Metadata } from "next";
import { AppShellView } from "@/components/app/AppShellView";
import type { CustomerProblemState } from "@/lib/customer-problem";
import { guardDevPage } from "@/server/dev-pages";
import { ProblemDemo } from "./ProblemDemo";
import styles from "./preview.module.css";
export const metadata: Metadata = { title: "Report a problem (dev)", robots: { index: false, follow: false } };
const states = ["form", "loading", "empty", "error", "offline", "uploading", "saving", "sent", "urgent", "photos", "load-error", "completed-sent"] as const;
const groups = { form: ["form", "empty", "loading", "error"], activity: ["offline", "uploading", "saving", "photos"], receipt: ["sent", "completed-sent", "urgent", "load-error"] } as const;
export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string; group?: string }> }) {
  guardDevPage();
  const { state, group } = await searchParams;
  const selected = states.includes(state as CustomerProblemState) ? state as typeof states[number] : "form";
  const gallery = group && Object.hasOwn(groups, group) ? groups[group as keyof typeof groups] : groups.form;
  return <AppShellView viewer={{ role: "CUSTOMER", firstName: "Sarah", lastName: "Thompson", email: "preview@example.test", emailVerified: true, counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: "/jobs/18200000-0000-4000-8000-000000000001/problem", base: "/dev/components/customer-problem" }}>
    {state === "gallery" ? <div className={styles.gallery}><h1>Report a problem states</h1>{gallery.map(item => <article key={item} aria-labelledby={`customer-state-${item}`}><h2 id={`customer-state-${item}`} className={styles.label}>{item}</h2><ProblemDemo state={item} embedded /></article>)}</div> : <ProblemDemo key={selected} state={selected} />}
  </AppShellView>;
}
