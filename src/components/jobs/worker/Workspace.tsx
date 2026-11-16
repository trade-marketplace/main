"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { TextLink } from "@/components/TextLink";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { OfflineBanner, useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { Skeleton, SkeletonText } from "@/components/feedback/Skeleton";
import { Banner } from "@/components/overlays/Banner";
import { Menu, MenuItem } from "@/components/overlays/Menu";
import { ToastProvider, useToast } from "@/components/overlays/Toast";
import { Tracker } from "@/components/status/Tracker";
import { formatCents } from "@/components/status/PriceBlock";
import { DAY_PARTS } from "@/lib/job-time-windows";
import { jobTracker } from "@/lib/job-tracker";
import { tryAgainText } from "@/lib/rate-limit";
import { claimDateLabel, signOffHours, type JobUpdateKind, type JobUpdateResult, type WorkspaceState, type WorkspaceView } from "@/lib/worker-workspace";
import type { AuthFailure } from "@/lib/auth/results";
import { sendJobUpdateAction } from "@/server/jobs/worker-updates-actions";
import styles from "./workspace.module.css";
import { ExtraWorkDrawer, type ExtraWorkServices } from "./ExtraWorkDrawer";
import { ExtraWorkCard } from "./ExtraWorkCard";
import type { ExtraWorkState, WorkerExtra } from "@/lib/worker-extras";
import { loadVariationAction } from "@/server/variations/actions";
import { myWorkReturn } from "@/lib/my-work";

type Props = { job: WorkspaceView; preview?: WorkspaceState; embedded?: boolean; send?: (id: string, kind: JobUpdateKind, lateMinutes?: number) => Promise<JobUpdateResult | AuthFailure>; myWorkHref?: string; extras?: WorkerExtra[]; extraPreview?: ExtraWorkState; extraServices?: ExtraWorkServices };
const extraReason = "Extra work sent. Waiting on the customer’s OK.";
export function Workspace(props: Props) {
  return <ToastProvider initial={props.extraPreview === "sent" ? { message: "Sent for pricing." } : props.preview === "sent" ? { message: `Sent to ${props.job.customer.firstName}.` } : undefined}><WorkspaceContent {...props} /></ToastProvider>;
}
function WorkspaceContent({ job, preview, embedded, send = sendJobUpdateAction, myWorkHref: suppliedReturn, extras: suppliedExtras = [], extraPreview, extraServices }: Props) {
  const myWorkHref = myWorkReturn(suppliedReturn) ?? "/dashboard";
  const router = useRouter();
  const [extras, setExtras] = useState(suppliedExtras), [drawer, setDrawer] = useState(Boolean(extraPreview && ["open", "uploading", "upload-error", "field-errors", "sending", "try-later", "error", "offline"].includes(extraPreview))), [requestKey, setRequestKey] = useState("16000000-0000-4000-8000-000000000001");
  const extraWorkOpen = job.extraWorkOpen || extras.some(extra => extra.status === "REQUESTED" || extra.status === "PRICED");
  useEffect(() => {
    if (extraPreview || !extras.some(extra => extra.status === "REQUESTED" || extra.status === "PRICED")) return;
    let disposed = false;
    const timer = setInterval(() => { for (const extra of extras.filter(item => item.status === "REQUESTED" || item.status === "PRICED")) void loadVariationAction(extra.id).then(result => {
      if (disposed || !result || !("workerEarnsCents" in result)) return;
      if (result.status !== extra.status) router.refresh();
      setExtras(previous => previous.map(item => item.id === extra.id ? { ...item, status: result.status, minutes: result.minutes, workerEarnsCents: result.workerEarnsCents } : item));
    }).catch(() => { /* Retain the last confirmed status while offline; next poll retries. */ }); }, 20_000);
    return () => { disposed = true; clearInterval(timer); };
  }, [extraPreview, extras, router]);
  const toast = useToast(), session = useOptionalSessionExpired(), online = useOnlineStatus(), pending = useRef(false), id = useId();
  const [busy, setBusy] = useState<JobUpdateKind | null>(null), [error, setError] = useState(preview === "error"), [wait, setWait] = useState(preview === "try-later" ? 300 : 0);
  const [last, setLast] = useState<{ kind: JobUpdateKind; lateMinutes?: number } | null>(preview === "error" ? { kind: "on-my-way" } : null);
  const [copied, setCopied] = useState(false), [copyError, setCopyError] = useState(false), [clock, setClock] = useState<number | null>(null);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const offline = !online || preview === "offline", sending = Boolean(busy) || preview === "sending", active = job.status === "ASSIGNED";
  const tracker = jobTracker(job.status, "tradie", { extraWork: extraWorkOpen, customerFirstName: job.customer.firstName, evidence: job.category === "ELECTRICAL" ? "coc" : "photos", payout: job.payout, autoReleaseHours: job.autoReleaseHours });
  const claim = claimDateLabel(job.claimedAt), jobNumber = `TM-${job.jobNumber}`, booked = Boolean(job.bookedDate && job.bookedTime);
  const hasBudget = job.budgetCents !== null && job.budgetCents > 0;
  const returnQuery = myWorkReturn(myWorkHref) ? `?from=${encodeURIComponent(myWorkHref)}` : "";
  const bookHref = `/jobs/${job.id}/book${returnQuery}`, finishHref = `/jobs/${job.id}/complete${returnQuery}`;
  const heading = <>{job.title}</>;
  const region = (label: string) => embedded ? `${label} (${extraPreview ?? preview})` : label;
  async function update(kind: JobUpdateKind, lateMinutes?: number) {
    if (pending.current || offline || sending || !active) return;
    pending.current = true; setBusy(kind); setError(false); setWait(0); setLast({ kind, lateMinutes });
    try {
      const result = await send(job.id, kind, lateMinutes);
      if (session?.check(result)) return;
      if (!("status" in result)) { setError(true); return; }
      if (result.status === "sent") toast.show({ message: kind === "customer-not-home" ? "The office has been told." : `Sent to ${job.customer.firstName}.` });
      else if (result.status === "try-later") setWait(result.retryAfter);
      else setError(true);
    } catch { setError(true); }
    finally { pending.current = false; setBusy(null); }
  }
  async function copyNumber() {
    setCopyError(false);
    try { await navigator.clipboard.writeText(jobNumber); setCopied(true); toast.show({ message: "Copied", icon: "content_copy" }); }
    catch { setCopyError(true); }
  }
  const finish = active && (extraWorkOpen ? <Button disabled={extraReason} icon="task_alt">Finish job</Button> : <Button href={finishHref} variant={booked ? "primary" : "secondary"} icon="task_alt">Finish job</Button>);
  return <section className={styles.canvas} data-mode="trade" aria-label={embedded ? `Workspace ${extraPreview ?? preview}` : undefined}><div className={styles.page}>
    {!embedded && <nav aria-label="Breadcrumb" className={styles.breadcrumb}><TextLink href={myWorkHref}>My work</TextLink><Icon name="chevron_right" size="sm" decorative /><span>{job.title}</span></nav>}
    <header className={styles.header}><div>{embedded ? <h3 className={styles.title}>{heading}</h3> : <h1 className={styles.title}>{heading}</h1>}<p className={styles.meta}>{jobNumber}{claim && ` · ${claim}`}{job.earnCents !== null && <> · <b>Earn {formatCents(job.earnCents)}</b></>}</p></div><div className={styles.finish} style={{ display: "flex", flexWrap: "wrap", gap: "var(--trade-space-3)" }}>{active && <Button variant="secondary" icon="add" disabled={extraWorkOpen ? "Extra work is already waiting." : offline} onClick={() => { setRequestKey(crypto.randomUUID()); setDrawer(true); }}>Extra work</Button>}{finish}</div></header>
    <OfflineBanner online={preview === "offline" ? false : undefined} sticky={false} />
    {extraWorkOpen && active && <Banner tone="info">{extraReason}</Banner>}
    {job.status === "SUBMITTED" && <Banner tone="info">Sent for sign-off.{job.signOffDeadline && <> <span>{signOffHours(job.signOffDeadline, clock ?? undefined)}h left</span></>}</Banner>}
    {job.status === "COMPLETED" && <Banner tone="good">Signed off.</Banner>}
    {job.status === "CANCEL_REVIEW" && <Banner tone="alert">On hold</Banner>}
    <div className={styles.layout}>
      <div className={styles.left}>
        <section className={styles.card} aria-label={region("Customer contact")}><div className={styles.person}><span className={styles.avatar} aria-hidden="true">{job.customer.firstName.charAt(0)}</span><div><h2 className={styles.cardTitle}>{job.customer.firstName}{job.customer.lastInitial && ` ${job.customer.lastInitial}.`}</h2><p className={styles.address}>{job.address}</p></div></div>{job.accessNotes && <p>{job.accessNotes}</p>}<div className={styles.contactActions}>{job.customer.phone && <Button href={`tel:${job.customer.phone.replace(/[^+\d]/g, "")}`} variant="secondary" size="sm" width="auto" icon="call">Call</Button>}<Button href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.address)}`} target="_blank" rel="noopener" variant="secondary" size="sm" width="auto" icon="directions">Directions</Button></div><TextLink href="/messages">Messages</TextLink></section>
        {(job.category === "ELECTRICAL" || hasBudget) && <section className={`${styles.card} ${styles.materials}`} aria-label={region("Materials")}>{job.category === "ELECTRICAL" && <><span className={styles.muted}>Telfer job no.</span><Button variant="tertiary" iconEnd="content_copy" onClick={() => void copyNumber()} aria-label={`Copy ${jobNumber}`}>{jobNumber}</Button>{copied && <span className={styles.muted}>Copied</span>}{copyError && <Banner tone="alert">Couldn’t copy. Try again.</Banner>}</>}{hasBudget && <p>Budget <b>{formatCents(job.budgetCents!)}</b></p>}{job.category !== "ELECTRICAL" && <p className={styles.muted}>Keep your receipt. You’ll add it when you finish.</p>}</section>}
      </div>
      <div className={styles.middle}>
        {extras.map((extra, index) => <ExtraWorkCard key={extra.id} extra={extra} customerFirstName={job.customer.firstName} label={region(extras.length > 1 ? `Extra work ${index + 1}` : "Extra work")} />)}
        <section className={styles.card} aria-label={region("Time")}>{booked ? <><h2 className={styles.cardTitle}>Booked: {new Intl.DateTimeFormat("en-NZ", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${job.bookedDate}T00:00:00Z`))} · {DAY_PARTS.find(part => part.value === job.bookedTime)?.label}</h2>{active && <TextLink href={bookHref}>Change</TextLink>}</> : <>{active ? <Button href={bookHref} icon="event">Book a time</Button> : <p>No time booked</p>}</>}</section>
        {active && <section className={styles.card} aria-label={embedded ? region("Updates") : undefined} aria-labelledby={embedded ? undefined : `${id}-updates`}><h2 id={`${id}-updates`} className={styles.cardTitle}>Updates</h2>{error && <Banner tone="alert" live action={<Button variant="tertiary" disabled={offline || sending} onClick={() => last && void update(last.kind, last.lateMinutes)}>Try again</Button>}>Couldn’t send this update. Try again.</Banner>}{wait > 0 && <Banner tone="alert" live>Too many tries. {tryAgainText(wait)}</Banner>}<div className={styles.updates}><Button variant="secondary" loading={busy === "on-my-way" || preview === "sending"} disabled={offline || sending} onClick={() => void update("on-my-way")} icon="local_shipping">I’m on my way</Button><Menu defaultOpen={preview === "late-menu"} align="start" trigger={props => <Button variant="secondary" disabled={offline || sending} loading={busy === "running-late"} icon="schedule" {...props}>Running late</Button>}>{[15, 30, 60].map(minutes => <MenuItem key={minutes} onSelect={() => void update("running-late", minutes)} disabled={offline || sending}>{minutes} min</MenuItem>)}</Menu><TextLink href={bookHref}>Need to reschedule</TextLink><Button variant="secondary" disabled={offline || sending} loading={busy === "customer-not-home"} onClick={() => void update("customer-not-home")} icon="door_front">Customer not home</Button></div></section>}
        <section className={styles.card} aria-label={region("Job details")}><h2 className={styles.cardTitle}>The job</h2><p>{job.description}</p></section>
      </div>
      {tracker && <aside className={styles.card} aria-label={region("Job progress")}><Tracker {...tracker} /></aside>}
    </div>
    <ExtraWorkDrawer key={requestKey} jobId={job.id} requestKey={requestKey} open={drawer} onClose={() => setDrawer(false)} preview={extraPreview} {...extraServices} onSent={(id, input) => {
      setExtras(previous => [{ id, status: "REQUESTED" as const, description: input.description, requestedMinutes: Math.round(input.hours * 60), minutes: null, workerEarnsCents: null, photoCount: input.photoPaths.length, createdAt: new Date().toISOString() }, ...previous].slice(0, 5)); setDrawer(false); toast.show({ message: "Sent for pricing." });
    }} />
  </div></section>;
}
export function WorkspaceLoading({ embedded = false, myWorkHref }: { embedded?: boolean; myWorkHref?: string }) { const back = myWorkReturn(myWorkHref); return <section className={styles.canvas} data-mode="trade"><div className={styles.page} role="status" aria-label="Loading workspace">{!embedded && <>{back && <TextLink href={back}>My work</TextLink>}<h1 className={styles.srOnly}>Job workspace</h1></>}<SkeletonText /><div className={styles.layout}>{[0, 1, 2].map(key => <div key={key} className={styles.card}><Skeleton height={120} /><SkeletonText /></div>)}</div></div></section>; }
export function WorkspaceLoadError({ embedded = false, retry, myWorkHref }: { embedded?: boolean; retry?: () => void; myWorkHref?: string }) { const router = useRouter(); return <section className={styles.canvas} data-mode="trade"><div className={styles.page}><TextLink href={myWorkReturn(myWorkHref) ?? "/dashboard"}>My work</TextLink><div className={styles.card}>{embedded ? <h3>Couldn’t load this job</h3> : <h1>Couldn’t load this job</h1>}<Banner tone="alert">Try again</Banner><Button onClick={() => retry ? retry() : router.refresh()}>Try again</Button></div></div></section>; }
