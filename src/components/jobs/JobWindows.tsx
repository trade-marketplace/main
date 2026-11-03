"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { OfflineBanner, useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { Skeleton } from "@/components/feedback/Skeleton";
import { Banner } from "@/components/overlays/Banner";
import { ToastProvider, useToast } from "@/components/overlays/Toast";
import type { AuthFailure } from "@/lib/auth/results";
import { jobScheduleSchema, type JobSchedule } from "@/lib/job-draft";
import { currentSchedule, postingDateRange, timeWindowsInRange } from "@/lib/job-time-windows";
import type { JobWindowsSnapshot, SaveJobWindowsResult } from "@/lib/job-windows";
import { saveJobWindowsAction } from "@/server/jobs/window-actions";
import { ScheduleFields } from "./ScheduleFields";
import styles from "./job-windows.module.css";

type Props = { initial: JobWindowsSnapshot; initialNow: string; save?: (id: string, input: JobSchedule, revision: string) => Promise<SaveJobWindowsResult | AuthFailure>; preview?: string };
export function JobWindows(props: Props) { return <ToastProvider><WindowForm {...props} /></ToastProvider>; }
function WindowForm({ initial, initialNow, save = saveJobWindowsAction, preview }: Props) {
  const router = useRouter(); const toast = useToast(); const session = useOptionalSessionExpired(); const online = useOnlineStatus();
  const [snapshot, setSnapshot] = useState(initial); const [value, setValue] = useState(initial.schedule);
  const [now, setNow] = useState(() => new Date(initialNow));
  const [busy, setBusy] = useState(false); const pending = useRef(false);
  const [error, setError] = useState(preview === "error"); const [changed, setChanged] = useState(preview === "changed"); const [field, setField] = useState<string>();
  const form = useRef<HTMLFormElement>(null); const offline = !online || preview === "offline";
  useEffect(() => {
    if (preview) return;
    const timer = setInterval(() => setNow(previous => postingDateRange(previous).today === postingDateRange(new Date()).today ? previous : new Date()), 60_000);
    return () => clearInterval(timer);
  }, [preview]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending.current || offline || !snapshot.editable) return;
    const parsed = jobScheduleSchema.safeParse(value); const schedule = currentSchedule(value, now);
    if (!parsed.success || !timeWindowsInRange(schedule.timeWindows, now)) { setField("When do you need it?"); form.current?.querySelector<HTMLInputElement>('input[name="time-windows"]')?.focus(); return; }
    pending.current = true; setBusy(true); setError(false); setChanged(false);
    try {
      const result = await save(snapshot.id, schedule, snapshot.revision);
      if (session?.check(result)) return;
      if (!("status" in result)) { setError(true); return; }
      if (result.status === "saved" || result.status === "changed") {
        setSnapshot(result.snapshot); setValue(result.snapshot.schedule); setField(undefined);
        if (result.status === "changed") setChanged(true);
        else { toast.show({ message: "Saved." }); router.refresh(); }
      } else if (result.status === "invalid") setField(result.fields.timeWindows ?? "When do you need it?");
      else setError(true);
    } catch { setError(true); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className={styles.page} data-mode="customer">
    <Button href="/notifications" variant="tertiary" width="auto" icon="arrow_back">Back</Button>
    <div className={styles.card}>
      <p className={styles.eyebrow}>Job #{snapshot.jobNumber}</p><h1 className={styles.title}>When do you need it?</h1><p className={styles.job}>{snapshot.title}</p>
      <OfflineBanner online={preview === "offline" ? false : undefined} sticky={false} />
      {changed && <Banner tone="info" title="Job updated" />}
      {error && <Banner tone="alert" title="Couldn’t save." live />}
      <form ref={form} onSubmit={event => void submit(event)} className={styles.form} noValidate>
        <ScheduleFields value={value} now={now} error={field} disabled={!snapshot.editable || busy || preview === "saving"} onChange={next => { setValue(currentSchedule(next, now)); setField(undefined); setChanged(false); }} />
        <div className={styles.actions}><Button type="submit" loading={busy || preview === "saving"} disabled={offline || !snapshot.editable}>Save changes</Button></div>
      </form>
    </div>
  </section>;
}
export function JobWindowsLoading() { return <section className={styles.page}><div className={styles.card} role="status" aria-label="Loading time windows"><Skeleton height={38} width="65%" /><Skeleton height={48} /><Skeleton height={340} /></div></section>; }
export function JobWindowsLoadError() { const router = useRouter(); return <section className={styles.page}><Button href="/notifications" variant="tertiary" icon="arrow_back" width="auto">Back</Button><div className={styles.card}><h1 className={styles.title}>When do you need it?</h1><Banner tone="alert" title="Couldn’t load the job." action={<Button variant="tertiary" onClick={() => router.refresh()}>Try again</Button>} /></div></section>; }
