"use client";
import { BookWindow } from "@/components/jobs/worker/BookWindow";
import { Button } from "@/components/Button";
import { ToastProvider } from "@/components/overlays/Toast";
import { availableBookingWindows, bookingWindowLabel, type BookingSnapshot, type BookingState } from "@/lib/worker-booking";
import { useRouter } from "next/navigation";
const base = "/dev/components/worker-book";
export function BookDemo({ state, view, message }: { state: BookingState; view?: string; message?: string }) {
  const router = useRouter();
  const windows = [{ date: "2026-11-12", timeOfDay: "MORNING" as const }, { date: "2026-11-12", timeOfDay: "EVENING" as const }, { date: "2026-11-13", timeOfDay: "EVENING" as const }, { date: "2026-11-14", timeOfDay: "MORNING" as const }, { date: "2026-11-14", timeOfDay: "AFTERNOON" as const }];
  const job: BookingSnapshot = { id: "14600000-0000-4000-8000-000000000001", title: "Sub wiring", suburb: "Windsor", customerFirstName: "Sarah", anyTime: state === "any-time", windows: state === "none-left" ? [] : state === "any-time" ? availableBookingWindows([], true, new Date("2026-11-12T00:00:00Z")) : windows, booked: state === "booked" ? windows[0] : null, revision: "preview" };
  if (view === "job") return <ToastProvider initial={message ? { message } : undefined}><section style={{ padding: "var(--trade-space-6)" }}><h1>Sub wiring</h1><Button href={`${base}?state=${state}`}>Book a time</Button></section></ToastProvider>;
  return <BookWindow initial={job} state={state} backHref={`${base}?state=${state}&view=job`} book={async (_id, value) => ({ status: "booked", window: value as typeof windows[number], rescheduled: Boolean(job.booked) })} request={async () => ({ status: "asked" })} onBooked={result => router.push(`${base}?state=${state}&view=job&message=${encodeURIComponent(`${result.rescheduled ? "Changed to" : "Booked"} ${bookingWindowLabel(result.window)}`)}`)} />;
}
