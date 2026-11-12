import type { Metadata } from "next";
import { AppShellView } from "@/components/app/AppShellView";
import { CustomerJob, CustomerJobLoading, CustomerJobLoadError } from "@/components/jobs/CustomerJob";
import { ConfirmedWindowsDemo } from "./ConfirmedWindowsDemo";
import { exampleJob, VIEWERS } from "@/app/dev/components/job-views/preview-data";
import { customerJobView } from "@/server/views";
import { NOTIFICATION_COPY } from "@/server/notifications/inbox";
import { guardDevPage } from "@/server/dev-pages";
import type { CustomerWorkerCard, CustomerWorkerUpdateType } from "@/lib/customer-worker-card";
import styles from "@/components/jobs/customer/confirmed.module.css";

export const metadata: Metadata = { title: "Tradie confirmed (dev)", robots: { index: false, follow: false } };
const makeUpdate = (type: CustomerWorkerUpdateType, index = 0) => ({ id: `preview-${type}-${index}`, type, label: NOTIFICATION_COPY[type][0], createdAt: new Date(Date.UTC(2026, 10, 6, 0, 30 - index * 10)).toISOString(), lateMinutes: type === "job.running_late" ? 30 as const : null });

function example(state: string, suffix = "") {
  const finding = state === "finding";
  const source = exampleJob({ id: suffix ? `12700000-0000-4000-8000-${suffix.padStart(12, "0")}` : "12700000-0000-4000-8000-000000000001", ...(suffix ? { title: `Sub wiring · ${state}`, jobNumber: 1005 + Number(suffix) } : {}), status: finding ? "BOOKABLE" : "ASSIGNED", ...(finding ? { workerId: null, worker: null } : {}),
    bookedDate: state === "confirmed" ? null : new Date("2026-11-06"), bookedTime: state === "confirmed" ? null : "MORNING", ...(state === "other-trade" ? { category: "OTHER" } : {}) });
  const job = customerJobView(VIEWERS.customer, source)!;
  const updates = state === "asked-for-times" ? [makeUpdate("job.reschedule_requested"), makeUpdate("job.window_booked", 1)] : state === "running-late" ? [makeUpdate("job.running_late"), makeUpdate("job.window_booked", 1)] : state === "updates" ? [makeUpdate("job.on_my_way"), makeUpdate("job.running_late", 1), makeUpdate("job.window_booked", 2)] : [];
  const card: CustomerWorkerCard | null = state === "card-unavailable" ? null : { avatarUrl: state === "photo-error" ? "/images/confirmed-avatar-missing.jpg" : null, licensed: state !== "other-trade", rating: state === "no-reviews" || state === "empty" ? null : { average: 4.9, count: 32 }, updates, askedForTimes: state === "asked-for-times" };
  return { job, card };
}

function Demo({ state, suffix }: { state: string; suffix?: string }) {
  const { job, card } = example(state, suffix);
  return state === "loading" ? <CustomerJobLoading /> : state === "error" ? <CustomerJobLoadError /> : <CustomerJob job={job} workerCard={card} back="/dashboard?q=Sub+wiring" photos={state === "empty" ? [] : ["wires", "switch", "board"].map((name, index) => ({ src: `/images/examples/${name}.jpg`, alt: `${job.title} · ${index + 1}` }))} preview={state === "offline" ? "offline" : "static"} canEditWindows={state === "finding"} confirmedWindowsHref="/dev/components/customer-confirmed?state=windows" />;
}

export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  guardDevPage();
  const { state = "confirmed" } = await searchParams;
  return <AppShellView viewer={{ role: "CUSTOMER", firstName: "Sarah", lastName: "Thompson", email: "customer@demo.test", emailVerified: true, counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: "/jobs/12700000-0000-4000-8000-000000000001", base: "/dev/components/customer-confirmed" }}>
    {state === "recovery" ? <div className={styles.gallery}>{["empty", "error", "offline", "photo-error"].map((item, index) => <section key={item} aria-labelledby={`confirmed-${item}`}><h1 id={`confirmed-${item}`}>{item}</h1><Demo state={item} suffix={String(index + 20)} /></section>)}</div> : state === "windows" ? <ConfirmedWindowsDemo now={new Date().toISOString()} /> : <Demo state={state} />}
  </AppShellView>;
}
