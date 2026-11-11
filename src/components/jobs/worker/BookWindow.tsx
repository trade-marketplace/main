"use client";
import { useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { TextLink } from "@/components/TextLink";
import { RadioGroup } from "@/components/forms/ChoiceFields";
import { Banner } from "@/components/overlays/Banner";
import { ToastProvider } from "@/components/overlays/Toast";
import { Skeleton, SkeletonText } from "@/components/feedback/Skeleton";
import { OfflineBanner, useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import type { AuthFailure } from "@/lib/auth/results";
import { timeWindowKey } from "@/lib/job-time-windows";
import { bookingButtonLabel, bookingDateLabel, bookingWindowLabel, type BookingResult, type BookingSnapshot, type BookingState, type RequestTimesResult } from "@/lib/worker-booking";
import { bookJobWindowAction, requestOtherTimesAction } from "@/server/jobs/worker-booking-actions";
import styles from "./book-window.module.css";

// The destination is owned by a separate task. Keep the kit toast mounted across client navigation.
let receipt: { root: Root; node: HTMLDivElement } | undefined;
function bookingToast(message: string) {
  if (receipt) { receipt.root.unmount(); receipt.node.remove(); }
  const node = document.createElement("div"); node.dataset.mode = "trade"; document.body.append(node);
  const root = createRoot(node); root.render(<ToastProvider initial={{ message }}><span /></ToastProvider>);
  receipt = { root, node };
}
type Props = { initial: BookingSnapshot; state?: BookingState; backHref?: string; onBooked?: (result: Extract<BookingResult, { status: "booked" }>) => void;
  book?: (id: string, window: unknown, revision: string) => Promise<BookingResult | AuthFailure>; request?: (id: string) => Promise<RequestTimesResult | AuthFailure> };
export function BookWindow({ initial, state = "pick", backHref = `/jobs/${initial.id}`, book = bookJobWindowAction, request = requestOtherTimesAction, onBooked }: Props) {
  const [job, setJob] = useState(initial), [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false), [asked, setAsked] = useState(state === "asked"), [error, setError] = useState(state === "error"), [changed, setChanged] = useState(state === "changed");
  const [lastRequest, setLastRequest] = useState(false);
  const pending = useRef(false), router = useRouter(), session = useOptionalSessionExpired(), online = useOnlineStatus();
  const saving = busy || state === "saving", offline = !online || state === "offline";
  const picked = job.windows.find(window => timeWindowKey(window) === selected) ?? null;
  async function submit(otherTimes = false) {
    if (pending.current || saving || offline || (!otherTimes && !picked)) return;
    pending.current = true; setBusy(true); setError(false); setLastRequest(otherTimes);
    try {
      const result = otherTimes ? await request(job.id) : await book(job.id, picked, job.revision);
      if (session?.check(result)) return;
      if (!("status" in result)) { setError(true); return; }
      if (result.status === "asked") { setAsked(true); setChanged(false); }
      else if (result.status === "changed") { setJob(result.snapshot); setSelected(""); setChanged(true); setAsked(false); }
      else if (result.status === "booked") {
        if (onBooked) onBooked(result);
        else { router.push(backHref); bookingToast(`${result.rescheduled ? "Changed to" : "Booked"} ${bookingWindowLabel(result.window)}`); }
      } else setError(true);
    } catch { setError(true); }
    finally { pending.current = false; setBusy(false); }
  }
  if (state === "loading") return <BookWindowLoading />;
  if (state === "load-error") return <BookWindowLoadError backHref={backHref} />;
  const dates = [...new Set(job.windows.map(window => window.date))];
  return <section data-mode="trade" className={styles.canvas}><div className={styles.page}>
    <TextLink href={backHref}>Back to job</TextLink>
    <header><h1>Pick a time</h1><p className={styles.subtitle}>{job.title} · {job.suburb}</p></header>
    <div className={styles.body}>
      {job.booked && <Banner tone="info">Booked: {bookingWindowLabel(job.booked)}</Banner>}
      <p>{job.anyTime ? `Any time works for ${job.customerFirstName}.` : `${job.customerFirstName}’s free in these windows. Pick one and ${job.customerFirstName}’s told straight away. No back-and-forth.`}</p>
      <OfflineBanner online={state === "offline" ? false : undefined} sticky={false} />
      {changed && <Banner tone="info" live>{job.customerFirstName} changed the times. Pick again.</Banner>}
      {asked && <Banner tone="info" live>{job.customerFirstName}’s been asked for more times.</Banner>}
      {error && <Banner tone="alert" live action={<Button variant="tertiary" disabled={offline || saving} onClick={() => void submit(lastRequest)}>Try again</Button>}>Couldn’t save. Try again.</Banner>}
      {dates.length ? <div className={styles.windows}>{dates.map(date => <RadioGroup key={date} className={styles.day} label={bookingDateLabel(date)} name={`booking-${job.id}`} value={selected} disabled={saving || offline}
        options={job.windows.filter(window => window.date === date).map(window => ({ value: timeWindowKey(window), label: bookingWindowLabel(window).split(" · ")[1] }))} onChange={setSelected} />)}</div> : <p>None of {job.customerFirstName}’s times are left.</p>}
      <Banner tone="info">Running late? Use “I’m on my way” and “Running late” on the job. No texting needed.</Banner>
    </div>
    <div className={styles.actions}>
      {dates.length > 0 && <Button width="full" loading={saving && !lastRequest} disabled={!picked || offline || saving} onClick={() => void submit()}>{bookingButtonLabel(picked, Boolean(job.booked))}</Button>}
      <Button variant="secondary" width="full" loading={saving && lastRequest} disabled={offline || saving || asked} onClick={() => void submit(true)}>Suggest other times</Button>
    </div>
  </div></section>;
}
export function BookWindowLoading() { return <section className={styles.canvas} data-mode="trade"><div className={styles.page} role="status" aria-label="Loading times"><h1 className={styles.srOnly}>Pick a time</h1><Skeleton height={52} /><SkeletonText /><Skeleton height={200} /><Skeleton height={55} /></div></section>; }
export function BookWindowLoadError({ backHref }: { backHref: string }) { const router = useRouter(); return <section className={styles.canvas} data-mode="trade"><div className={styles.page}><TextLink href={backHref}>Back to job</TextLink><h1>Couldn’t load times</h1><Banner tone="alert">Try again</Banner><Button onClick={() => router.refresh()}>Try again</Button></div></section>; }
