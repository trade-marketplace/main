import type { Metadata } from "next";
import { exampleJob, VIEWERS } from "@/app/dev/components/job-views/preview-data";
import { workerClaimView } from "@/server/jobs/worker-claim-reader";
import { AppShellView } from "@/components/app/AppShellView";
import { BOOKING_STATES, type BookingState } from "@/lib/worker-booking";
import { guardDevPage } from "@/server/dev-pages";
import { BookDemo } from "./BookDemo";
export const metadata: Metadata = { title: "Book a time (dev)", robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string; view?: string; message?: string }> }) {
  guardDevPage();
  const search = await searchParams, state = BOOKING_STATES.includes(search.state as BookingState) ? search.state as BookingState : "pick";
  const entry = search.view === "entry" ? workerClaimView(VIEWERS.worker, exampleJob({ title: "Sub wiring", suburb: "Windsor", status: "ASSIGNED", workerId: VIEWERS.worker.userId }), { cocRequired: true, minPhotos: 0, notesRequired: false }) ?? undefined : undefined;
  return <AppShellView viewer={{ role: "TRADIE", firstName: "Jack", lastName: "Wilson", email: "preview@example.test", emailVerified: true, counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: "/jobs", base: "/dev/components/worker-book" }}><BookDemo key={`${state}/${search.view}`} state={state} view={search.view} message={search.message} entry={entry} /></AppShellView>;
}
